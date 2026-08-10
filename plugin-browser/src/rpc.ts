// The frontend data plane: one contract shared by server.ts and app.tsx.
//
// Every method names the thread it acts for. The backend resolves that thread
// to a session key, which a spawned thread shares with its parent, and
// `status` returns the key it settled on so the panel subscribes with it.
import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

import type { Bridge } from "./bridge.ts";
import { install, type InstallPaths } from "./install.ts";
import type { SessionKeyResolver } from "./session-key.ts";
import type { TabRegistry, TabSummary } from "./tabs.ts";
import { normalizeUrl } from "./url.ts";

const tabSchema = z.object({
  tabId: z.number(),
  windowId: z.number(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  loading: z.boolean(),
});

const statusSchema = z.object({
  connected: z.boolean(),
  browsers: z.array(z.object({ id: z.string(), version: z.string() })),
  /** The session this thread actually drives, which may be an ancestor's. */
  sessionKey: z.string(),
  tab: tabSchema.nullable(),
  extensionDir: z.string(),
});

const sessionShape = { session: z.string().min(1) };
const sessionInput = z.object(sessionShape).strict();
const withSession = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...sessionShape, ...shape }).strict();

export const rpcContract = defineRpcContract({
  status: { input: sessionInput, output: statusSchema },
  tabs: { input: sessionInput, output: z.object({ tabs: z.array(tabSchema) }) },
  open: { input: withSession({ url: z.string() }), output: tabSchema },
  attach: { input: withSession({ tabId: z.number() }), output: tabSchema },
  release: { input: sessionInput, output: z.null() },
  close: { input: sessionInput, output: z.null() },
  show: { input: sessionInput, output: z.null() },
  reload: { input: sessionInput, output: z.null() },
  preview: {
    input: sessionInput,
    output: z.object({ dataUrl: z.string().nullable() }),
  },
  install: { input: z.null(), output: z.object({ summary: z.string() }) },
});

export interface RpcDeps {
  bridge: Bridge;
  tabs: TabRegistry;
  resolveSessionKey: SessionKeyResolver;
  installPaths: InstallPaths;
  extensionDir: string;
}

export function createRpcHandlers(deps: RpcDeps) {
  const status = async ({ session }: { session: string }) => {
    const sessionKey = await deps.resolveSessionKey(session);
    const resolved = await deps.tabs.resolve(sessionKey);
    const tab = resolved
      ? await resolved.connection
          .request<TabSummary>("tabs.get", { tabId: resolved.tabId })
          .catch(() => null)
      : null;
    const connections = deps.bridge.connections();
    return {
      connected: connections.length > 0,
      browsers: connections.map((connection) => ({
        id: connection.id,
        version: connection.version,
      })),
      sessionKey,
      tab,
      extensionDir: deps.extensionDir,
    };
  };

  const bound = async (session: string) =>
    deps.tabs.require(await deps.resolveSessionKey(session));

  return {
    status,

    tabs: async ({ session: _session }: { session: string }) =>
      deps.tabs.connection().request<{ tabs: TabSummary[] }>("tabs.list"),

    open: async ({ session, url }: { session: string; url: string }) =>
      deps.tabs.open(await deps.resolveSessionKey(session), normalizeUrl(url), {
        active: false,
      }),

    attach: async ({ session, tabId }: { session: string; tabId: number }) =>
      deps.tabs.attach(await deps.resolveSessionKey(session), tabId),

    release: async ({ session }: { session: string }) => {
      await deps.tabs.release(await deps.resolveSessionKey(session));
      return null;
    },

    close: async ({ session }: { session: string }) => {
      const sessionKey = await deps.resolveSessionKey(session);
      const { connection, tabId } = await deps.tabs.require(sessionKey);
      await connection.request("tabs.close", { tabId });
      await deps.tabs.release(sessionKey);
      return null;
    },

    show: async ({ session }: { session: string }) => {
      const { connection, tabId } = await bound(session);
      await connection.request("tabs.select", { tabId });
      return null;
    },

    reload: async ({ session }: { session: string }) => {
      const { connection, tabId } = await bound(session);
      await connection.request("tabs.reload", { tabId });
      return null;
    },

    preview: async ({ session }: { session: string }) => {
      const sessionKey = await deps.resolveSessionKey(session);
      const resolved = await deps.tabs.resolve(sessionKey);
      if (!resolved) return { dataUrl: null };
      const { data } = await resolved.connection.request<{ data: string }>(
        "page.screenshot",
        { tabId: resolved.tabId },
      );
      return { dataUrl: `data:image/png;base64,${data}` };
    },

    install: async () => {
      const result = await install(deps.installPaths);
      const browsers = result.manifests.map((entry) => entry.browser).join(", ");
      return {
        summary: browsers
          ? `Native host installed for ${browsers}. Load the unpacked extension next.`
          : "No Chromium-family browser profile was found to install into.",
      };
    },
  };
}
