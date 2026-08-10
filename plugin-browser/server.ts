// bb-plugin-browser — bb agents driving the user's own Chrome.
//
// A Chrome extension holds the browser side, a native messaging host bridges
// it to this plugin over a unix socket, and each thread binds one tab. Nothing
// here launches a browser: the pages, the profile, and the logged-in sessions
// are the user's own.
import { join } from "node:path";

import type { BbPluginApi } from "@bb/plugin-sdk";

import { Bridge } from "./src/bridge.ts";
import { createCliRegistration } from "./src/cli.ts";
import { extensionDir, install, installPaths } from "./src/install.ts";
import { createRpcHandlers, rpcContract } from "./src/rpc.ts";
import { createSessionKeyResolver } from "./src/session-key.ts";
import { TabRegistry } from "./src/tabs.ts";

export { rpcContract };

/** Per-session channel, so one thread's tab changes never wake another panel. */
export const changeChannel = (key: string) => `browser-changed:${key}`;
/** Fires when a browser connects or disconnects, which every panel cares about. */
export const connectionChannel = "browser-connections";
const CHANGE_DEBOUNCE_MS = 150;

export default async function plugin(bb: BbPluginApi) {
  const { dataDir } = await bb.sdk.system.config();
  const paths = installPaths(dataDir, bb.pluginId);

  const changeTimers = new Map<string, NodeJS.Timeout>();
  const publishChange = (key: string) => {
    if (changeTimers.has(key)) return;
    changeTimers.set(
      key,
      setTimeout(() => {
        changeTimers.delete(key);
        bb.realtime.publish(changeChannel(key), { at: Date.now() });
      }, CHANGE_DEBOUNCE_MS),
    );
  };

  const bridge = new Bridge({
    pointerPath: paths.pointerPath,
    log: (message) => bb.log.info(message),
    onChange: () => {
      bb.realtime.publish(connectionChannel, { at: Date.now() });
      void bb.storage.kv.set("everConnected", bridge.connections().length > 0);
    },
  });
  await bridge.start();

  const tabs = new TabRegistry({
    bridge,
    kv: bb.storage.kv,
    onChange: publishChange,
  });

  const resolveSessionKey = createSessionKeyResolver(bb);

  bb.rpc.register(
    rpcContract,
    createRpcHandlers({
      bridge,
      tabs,
      resolveSessionKey,
      installPaths: paths,
      extensionDir: extensionDir(),
    }),
  );

  bb.cli.register(
    createCliRegistration({ bb, bridge, tabs, resolveSessionKey, installPaths: paths }),
  );

  // A thread that is gone will never come back for its tab. Releasing drops
  // the debug session, leaving the user's tab open and unmarked.
  bb.events.on("thread.archived", ({ thread }) => void tabs.release(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => void tabs.release(thread.id));

  bb.onDispose(async () => {
    for (const timer of changeTimers.values()) clearTimeout(timer);
    changeTimers.clear();
    await bridge.stop();
  });

  // The manifest points Chrome at a wrapper holding absolute paths, so it goes
  // stale whenever bb moves. Rewriting it on every load keeps it true.
  try {
    await install(paths);
  } catch (error) {
    bb.log.warn(`Could not install the native messaging host: ${String(error)}`);
  }

  if (!(await bb.storage.kv.get<boolean>("everConnected"))) {
    bb.status.needsConfiguration(
      `Load the bb Browser extension in Chrome: open chrome://extensions, turn on Developer mode, choose "Load unpacked", and select ${join(extensionDir())}. Run \`bb browser install\` for the full instructions.`,
    );
  }
}
