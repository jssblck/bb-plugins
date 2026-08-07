// The frontend data plane: one contract shared by server.ts and app.tsx.
//
// Every method names the thread it acts for, because each thread drives its
// own browser context. The backend resolves that thread to a session key,
// which a spawned thread shares with its parent, and `status` returns the key
// it settled on so the panel can stream and subscribe with it.
import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

import { importChromeCookies } from "./cookie-import.ts";
import type { SessionKeyResolver } from "./session-key.ts";
import type { SessionRegistry } from "./sessions.ts";
import type { BrowserInput } from "./types.ts";
import { normalizeUrl } from "./url.ts";

const viewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
});

const tabSchema = z.object({
  targetId: z.string(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  active: z.boolean(),
});

const statusSchema = z.object({
  running: z.boolean(),
  headless: z.boolean(),
  chromeAvailable: z.boolean(),
  endpoint: z
    .object({ port: z.number(), path: z.string(), browserWsUrl: z.string() })
    .nullable(),
  browserContextId: z.string().nullable(),
  tabs: z.array(tabSchema),
  activeTargetId: z.string().nullable(),
  viewport: viewportSchema,
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** The session this thread actually drives, which may be an ancestor's. */
  sessionKey: z.string(),
  /** Authorizes the MJPEG stream route for this plugin load. */
  streamToken: z.string(),
});

const mouseInputSchema = z.object({
  kind: z.literal("mouse"),
  type: z.enum(["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  button: z
    .enum(["none", "left", "middle", "right", "back", "forward"])
    .optional(),
  clickCount: z.number().int().min(0).max(3).optional(),
  modifiers: z.number().int().min(0).max(15).optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
});

const keyInputSchema = z.object({
  kind: z.literal("key"),
  type: z.enum(["keyDown", "keyUp", "rawKeyDown", "char"]),
  key: z.string().optional(),
  code: z.string().optional(),
  text: z.string().optional(),
  unmodifiedText: z.string().optional(),
  modifiers: z.number().int().min(0).max(15).optional(),
  windowsVirtualKeyCode: z.number().int().optional(),
  nativeVirtualKeyCode: z.number().int().optional(),
  location: z.number().int().min(0).max(3).optional(),
  autoRepeat: z.boolean().optional(),
  isKeypad: z.boolean().optional(),
});

const inputSchema = z.discriminatedUnion("kind", [
  mouseInputSchema,
  keyInputSchema,
]);

const importResultSchema = z.object({
  source: z.enum(["live-cdp", "profile-database"]),
  profile: z.string().nullable(),
  fallbackReason: z.string().nullable(),
  scanned: z.number(),
  imported: z.number(),
  domains: z.array(z.string()),
});

const sessionShape = { session: z.string().min(1) };
const sessionInput = z.object(sessionShape).strict();
const withSession = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...sessionShape, ...shape }).strict();

export const rpcContract = defineRpcContract({
  status: { input: sessionInput, output: statusSchema },
  start: { input: sessionInput, output: statusSchema },
  stop: { input: sessionInput, output: statusSchema },
  navigate: { input: withSession({ url: z.string() }), output: z.null() },
  goBack: { input: sessionInput, output: z.null() },
  goForward: { input: sessionInput, output: z.null() },
  reload: { input: sessionInput, output: z.null() },
  newTab: {
    input: withSession({ url: z.string().optional() }),
    output: z.null(),
  },
  closeTab: { input: withSession({ targetId: z.string() }), output: z.null() },
  selectTab: { input: withSession({ targetId: z.string() }), output: z.null() },
  setViewport: { input: withSession(viewportSchema.shape), output: z.null() },
  sendInput: { input: withSession({ event: inputSchema }), output: z.null() },
  importCookies: {
    input: withSession({ domains: z.array(z.string()) }),
    output: importResultSchema,
  },
});

export interface RpcDeps {
  sessions: SessionRegistry;
  resolveSessionKey: SessionKeyResolver;
  streamToken: string;
  chromeAvailable: () => boolean;
  cookieProfile: () => Promise<string>;
}

export function createRpcHandlers(deps: RpcDeps) {
  const sessionFor = async (thread: string) =>
    deps.sessions.require(await deps.resolveSessionKey(thread));

  const status = async ({ session }: { session: string }) => {
    const sessionKey = await deps.resolveSessionKey(session);
    return {
      ...(await deps.sessions.require(sessionKey).status()),
      sessionKey,
      chromeAvailable: deps.chromeAvailable(),
      streamToken: deps.streamToken,
    };
  };

  return {
    status,
    start: async ({ session }: { session: string }) => {
      await (await sessionFor(session)).start();
      return status({ session });
    },
    stop: async ({ session }: { session: string }) => {
      await deps.sessions.dispose(await deps.resolveSessionKey(session));
      return status({ session });
    },
    navigate: async ({ session, url }: { session: string; url: string }) => {
      await (await sessionFor(session)).navigate(normalizeUrl(url));
      return null;
    },
    goBack: async ({ session }: { session: string }) => {
      await (await sessionFor(session)).goBack();
      return null;
    },
    goForward: async ({ session }: { session: string }) => {
      await (await sessionFor(session)).goForward();
      return null;
    },
    reload: async ({ session }: { session: string }) => {
      await (await sessionFor(session)).reload();
      return null;
    },
    newTab: async ({ session, url }: { session: string; url?: string }) => {
      await (
        await sessionFor(session)
      ).newTab(url ? normalizeUrl(url) : "about:blank");
      return null;
    },
    closeTab: async ({
      session,
      targetId,
    }: {
      session: string;
      targetId: string;
    }) => {
      await (await sessionFor(session)).closeTab(targetId);
      return null;
    },
    selectTab: async ({
      session,
      targetId,
    }: {
      session: string;
      targetId: string;
    }) => {
      await (await sessionFor(session)).setActiveTab(targetId);
      return null;
    },
    setViewport: async ({
      session,
      ...viewport
    }: {
      session: string;
      width: number;
      height: number;
      deviceScaleFactor: number;
    }) => {
      await (await sessionFor(session)).setViewport(viewport);
      return null;
    },
    sendInput: async ({
      session,
      event,
    }: {
      session: string;
      event: BrowserInput;
    }) => {
      await (await sessionFor(session)).dispatchInput(event);
      return null;
    },
    importCookies: async ({
      session,
      domains,
    }: {
      session: string;
      domains: string[];
    }) =>
      importChromeCookies(await sessionFor(session), {
        domains,
        profile: await deps.cookieProfile(),
      }),
  };
}
