// bb-plugin-browser — a Chrome browser view inside BB, with its CDP endpoint
// exposed to agents and a cookie bridge from the user's own Chrome.
//
// One Chrome process serves every thread, and each thread drives its own
// isolated browser context: separate tabs, cookies, storage, and viewport. A
// spawned thread shares its parent's, so a workflow's subagents and their
// coordinator drive one browser.
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { BbPluginApi } from "@bb/plugin-sdk";

import { findChromeBinary } from "./src/chrome.ts";
import { createCliRegistration } from "./src/cli.ts";
import { ChromeHost } from "./src/host.ts";
import { createRpcHandlers, rpcContract } from "./src/rpc.ts";
import { createSessionKeyResolver } from "./src/session-key.ts";
import { SessionRegistry } from "./src/sessions.ts";
import { createStreamHandler } from "./src/stream.ts";

export { rpcContract };

/** Per-session channel, so one thread's tab churn never wakes another panel. */
export const changeChannel = (key: string) => `browser-changed:${key}`;
const CHANGE_DEBOUNCE_MS = 150;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    cookieProfile: {
      type: "string",
      label: "Chrome profile (blank uses your last-used profile)",
      default: "",
    },
  });

  const { dataDir } = await bb.sdk.system.config();
  const host = new ChromeHost({
    userDataDir: join(dataDir, "plugins", bb.pluginId, "chrome-profile"),
    headless: true,
    log: (message) => bb.log.info(message),
  });

  const changeTimers = new Map<string, NodeJS.Timeout>();
  const sessions = new SessionRegistry({
    host,
    log: (message) => bb.log.info(message),
    onChange: (key) => {
      if (changeTimers.has(key)) return;
      changeTimers.set(
        key,
        setTimeout(() => {
          changeTimers.delete(key);
          bb.realtime.publish(changeChannel(key), { at: Date.now() });
        }, CHANGE_DEBOUNCE_MS),
      );
    },
  });

  const streamToken = randomBytes(32).toString("hex");
  const cookieProfile = async () => (await settings.get()).cookieProfile;
  const resolveSessionKey = createSessionKeyResolver(bb);

  bb.rpc.register(
    rpcContract,
    createRpcHandlers({
      sessions,
      resolveSessionKey,
      streamToken,
      chromeAvailable: () => findChromeBinary() !== null,
      cookieProfile,
    }),
  );

  // The <img> tag that renders the live view cannot carry an auth header, so
  // this route checks its own per-load token instead.
  bb.http.route("GET", "/stream", createStreamHandler(sessions, streamToken), {
    auth: "none",
  });

  bb.cli.register(
    createCliRegistration({ bb, sessions, resolveSessionKey, cookieProfile }),
  );

  // A thread that is gone will never come back for its tabs. A subagent's id is
  // never a session key, so losing one leaves its coordinator's browser alone.
  bb.events.on("thread.archived", ({ thread }) => sessions.dispose(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => sessions.dispose(thread.id));

  bb.onDispose(async () => {
    for (const timer of changeTimers.values()) clearTimeout(timer);
    changeTimers.clear();
    await sessions.disposeAll();
  });

  if (!findChromeBinary()) {
    bb.status.needsConfiguration(
      "No Chrome binary found. Install Google Chrome, then run `bb plugin reload browser`.",
    );
  }
}
