// The shared Chrome process: lifecycle, one CDP connection, and target routing.
//
// One Chrome serves every session. Isolation comes from CDP browser contexts:
// each session owns one, and Chrome keeps their cookies, storage, and tabs
// apart the way it keeps incognito windows apart. Targets arrive on the single
// browser-level connection, so this class routes each one to the session that
// owns its context.
import type { ChildProcess } from "node:child_process";

import { CdpConnection } from "./cdp.ts";
import {
  findChromeBinary,
  launchChrome,
  type DevToolsEndpoint,
} from "./chrome.ts";

export interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
  title: string;
  browserContextId?: string;
}

/** The half of a session the host drives: target and page event delivery. */
export interface SessionTargetSink {
  onTargetAttached(cdpSessionId: string, info: CdpTargetInfo): void;
  onTargetGone(targetId: string): void;
  onTargetInfoChanged(info: CdpTargetInfo): void;
  onLoadingChanged(
    cdpSessionId: string,
    frameId: string,
    loading: boolean,
  ): void;
  onScreencastFrame(
    cdpSessionId: string,
    data: string,
    ackSessionId: number,
  ): void;
  /** Chrome died: drop every target and context id this session held. */
  onHostLost(): void;
}

export interface ChromeHostOptions {
  userDataDir: string;
  headless: boolean;
  log: (message: string) => void;
}

/** Chrome's launch window, and the size an unconfigured session starts at. */
export const DEFAULT_WINDOW = { width: 1280, height: 800 };

export class ChromeHost {
  #options: ChromeHostOptions;
  #child: ChildProcess | null = null;
  #connection: CdpConnection | null = null;
  #endpoint: DevToolsEndpoint | null = null;
  #starting: Promise<void> | null = null;
  #sinksByContext = new Map<string, SessionTargetSink>();
  #sinksByCdpSession = new Map<string, SessionTargetSink>();
  #sinksByTarget = new Map<string, SessionTargetSink>();

  constructor(options: ChromeHostOptions) {
    this.#options = options;
  }

  get isRunning(): boolean {
    return this.#connection?.isOpen === true;
  }

  get headless(): boolean {
    return this.#options.headless;
  }

  get endpoint(): DevToolsEndpoint | null {
    return this.isRunning ? this.#endpoint : null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    const binary = findChromeBinary();
    if (!binary)
      throw new Error("No Chrome binary found. Install Google Chrome.");
    const { child, endpoint } = await launchChrome({
      binary,
      userDataDir: this.#options.userDataDir,
      headless: this.#options.headless,
      windowSize: DEFAULT_WINDOW,
    });
    this.#child = child;
    this.#endpoint = endpoint;

    const connection = await CdpConnection.connect(endpoint.browserWsUrl);
    this.#connection = connection;
    connection.onClosed = () => {
      if (this.#connection === connection) this.#teardownState();
    };

    connection.on("Target.attachedToTarget", (params) => {
      const info = params.targetInfo as CdpTargetInfo;
      const cdpSessionId = params.sessionId as string;
      if (info.type !== "page") return;
      // Chrome's own startup tab lives in the default context, which no session
      // owns. Targets we did not create are not ours to drive.
      const sink = info.browserContextId
        ? this.#sinksByContext.get(info.browserContextId)
        : undefined;
      if (!sink) return;
      this.#sinksByCdpSession.set(cdpSessionId, sink);
      this.#sinksByTarget.set(info.targetId, sink);
      sink.onTargetAttached(cdpSessionId, info);
    });
    connection.on("Target.detachedFromTarget", (params) => {
      const cdpSessionId = params.sessionId as string | undefined;
      if (cdpSessionId) this.#sinksByCdpSession.delete(cdpSessionId);
      const targetId = params.targetId as string | undefined;
      if (targetId) this.#forgetTarget(targetId);
    });
    connection.on("Target.targetDestroyed", (params) => {
      this.#forgetTarget(params.targetId as string);
    });
    connection.on("Target.targetInfoChanged", (params) => {
      const info = params.targetInfo as CdpTargetInfo;
      this.#sinksByTarget.get(info.targetId)?.onTargetInfoChanged(info);
    });
    connection.on("Page.frameStartedLoading", (params, cdpSessionId) => {
      this.#pageSink(cdpSessionId)?.onLoadingChanged(
        cdpSessionId as string,
        params.frameId as string,
        true,
      );
    });
    connection.on("Page.frameStoppedLoading", (params, cdpSessionId) => {
      this.#pageSink(cdpSessionId)?.onLoadingChanged(
        cdpSessionId as string,
        params.frameId as string,
        false,
      );
    });
    connection.on("Page.screencastFrame", (params, cdpSessionId) => {
      this.#pageSink(cdpSessionId)?.onScreencastFrame(
        cdpSessionId as string,
        params.data as string,
        params.sessionId as number,
      );
    });

    await connection.send("Target.setDiscoverTargets", { discover: true });
    await connection.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    this.#options.log(`Chrome running on port ${endpoint.port}`);
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#connection?.close();
    this.#teardownState();
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  #teardownState(): void {
    const sinks = new Set(this.#sinksByContext.values());
    this.#connection = null;
    this.#child = null;
    this.#endpoint = null;
    this.#sinksByContext.clear();
    this.#sinksByCdpSession.clear();
    this.#sinksByTarget.clear();
    for (const sink of sinks) sink.onHostLost();
  }

  #pageSink(cdpSessionId: string | undefined): SessionTargetSink | undefined {
    return cdpSessionId ? this.#sinksByCdpSession.get(cdpSessionId) : undefined;
  }

  #forgetTarget(targetId: string): void {
    const sink = this.#sinksByTarget.get(targetId);
    if (!sink) return;
    this.#sinksByTarget.delete(targetId);
    sink.onTargetGone(targetId);
  }

  /** Start Chrome when needed and open an isolated context for one session. */
  async createContext(sink: SessionTargetSink): Promise<string> {
    await this.start();
    const { browserContextId } = await this.send<{ browserContextId: string }>(
      "Target.createBrowserContext",
      {},
    );
    this.#sinksByContext.set(browserContextId, sink);
    return browserContextId;
  }

  /** Closes the context and every tab in it. */
  async disposeContext(browserContextId: string): Promise<void> {
    this.#sinksByContext.delete(browserContextId);
    if (!this.isRunning) return;
    try {
      await this.send("Target.disposeBrowserContext", { browserContextId });
    } catch {
      // Chrome may already have dropped it.
    }
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    cdpSessionId?: string,
  ): Promise<T> {
    const connection = this.#connection;
    if (!connection) return Promise.reject(new Error("Browser is not running"));
    return connection.send<T>(method, params, cdpSessionId);
  }
}
