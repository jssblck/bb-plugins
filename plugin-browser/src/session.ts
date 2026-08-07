// One browsing session: its own CDP browser context, tabs, viewport, and view.
//
// Sessions are keyed by thread, so two threads never share a tab, an active
// tab, a viewport, or a cookie jar. All of them run inside the one Chrome the
// ChromeHost owns.
import type { CdpTargetInfo, ChromeHost, SessionTargetSink } from "./host.ts";
import { DEFAULT_WINDOW } from "./host.ts";
import type {
  BrowserInput,
  BrowserStatus,
  TabSummary,
  Viewport,
} from "./types.ts";

interface TabState {
  targetId: string;
  cdpSessionId: string;
  url: string;
  title: string;
  loading: boolean;
  mainFrameId: string | null;
}

const DEFAULT_VIEWPORT: Viewport = {
  width: DEFAULT_WINDOW.width,
  height: DEFAULT_WINDOW.height,
  deviceScaleFactor: 1,
};

export class BrowserSession implements SessionTargetSink {
  readonly key: string;
  #host: ChromeHost;
  #onChange: () => void;
  #log: (message: string) => void;
  #contextId: string | null = null;
  #opening: Promise<string> | null = null;
  #tabs = new Map<string, TabState>();
  #activeTargetId: string | null = null;
  #viewport: Viewport = DEFAULT_VIEWPORT;
  #lastFrame: Buffer | null = null;
  #frameSubscribers = new Set<(frame: Buffer) => void>();
  #lastActivityAt = Date.now();

  constructor(options: {
    key: string;
    host: ChromeHost;
    onChange: () => void;
    log: (message: string) => void;
  }) {
    this.key = options.key;
    this.#host = options.host;
    this.#onChange = options.onChange;
    this.#log = options.log;
  }

  get isRunning(): boolean {
    return this.#contextId !== null && this.#host.isRunning;
  }

  get browserContextId(): string | null {
    return this.isRunning ? this.#contextId : null;
  }

  get lastFrame(): Buffer | null {
    return this.#lastFrame;
  }

  /** Someone is watching the live view, which counts as in use. */
  get viewerCount(): number {
    return this.#frameSubscribers.size;
  }

  get idleForMs(): number {
    return Date.now() - this.#lastActivityAt;
  }

  touch(): void {
    this.#lastActivityAt = Date.now();
  }

  onFrame(subscriber: (frame: Buffer) => void): () => void {
    this.touch();
    this.#frameSubscribers.add(subscriber);
    return () => {
      this.#frameSubscribers.delete(subscriber);
      this.touch();
    };
  }

  /** Open the context and an initial tab, the state the panel expects. */
  async start(): Promise<void> {
    await this.requireActiveTab();
  }

  /** Close this session's context; the Chrome process keeps running. */
  async dispose(): Promise<void> {
    const contextId = this.#contextId;
    this.#reset();
    if (contextId) await this.#host.disposeContext(contextId);
  }

  #reset(): void {
    this.#contextId = null;
    this.#tabs.clear();
    this.#activeTargetId = null;
    this.#lastFrame = null;
    this.#onChange();
  }

  onHostLost(): void {
    this.#reset();
  }

  async #context(): Promise<string> {
    if (this.#contextId && this.#host.isRunning) return this.#contextId;
    this.#opening ??= this.#host
      .createContext(this)
      .then((contextId) => {
        this.#contextId = contextId;
        return contextId;
      })
      .finally(() => {
        this.#opening = null;
      });
    return this.#opening;
  }

  onTargetAttached(cdpSessionId: string, info: CdpTargetInfo): void {
    const tab: TabState = {
      targetId: info.targetId,
      cdpSessionId,
      url: info.url,
      title: info.title,
      loading: false,
      mainFrameId: null,
    };
    this.#tabs.set(info.targetId, tab);
    void this.#initializeTab(tab);
  }

  async #initializeTab(tab: TabState): Promise<void> {
    try {
      await this.#send("Page.enable", {}, tab.cdpSessionId);
      const tree = await this.#send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
        {},
        tab.cdpSessionId,
      );
      tab.mainFrameId = tree.frameTree.frame.id;
      await this.#applyViewport(tab.cdpSessionId);
    } catch (error) {
      this.#log(`Failed to initialize tab ${tab.targetId}: ${String(error)}`);
    }
    if (!this.#activeTargetId) await this.setActiveTab(tab.targetId);
    this.#onChange();
  }

  onTargetGone(targetId: string): void {
    if (!this.#tabs.delete(targetId)) return;
    if (this.#activeTargetId === targetId) {
      this.#activeTargetId = null;
      this.#lastFrame = null;
      const next = this.#tabs.keys().next();
      if (!next.done) void this.setActiveTab(next.value);
    }
    this.#onChange();
  }

  onTargetInfoChanged(info: CdpTargetInfo): void {
    const tab = this.#tabs.get(info.targetId);
    if (!tab) return;
    tab.url = info.url;
    tab.title = info.title;
    this.#onChange();
  }

  onLoadingChanged(
    cdpSessionId: string,
    frameId: string,
    loading: boolean,
  ): void {
    const tab = this.#tabBySession(cdpSessionId);
    if (!tab || tab.mainFrameId !== frameId) return;
    tab.loading = loading;
    this.#onChange();
  }

  onScreencastFrame(
    cdpSessionId: string,
    data: string,
    ackSessionId: number,
  ): void {
    const active = this.#activeTab();
    if (!active || active.cdpSessionId !== cdpSessionId) return;
    const frame = Buffer.from(data, "base64");
    this.#lastFrame = frame;
    for (const subscriber of [...this.#frameSubscribers]) {
      try {
        subscriber(frame);
      } catch {
        // A stalled viewer must not break the capture loop.
      }
    }
    void this.#send(
      "Page.screencastFrameAck",
      { sessionId: ackSessionId },
      cdpSessionId,
    ).catch(() => {
      // The tab went away between frame and ack.
    });
  }

  #activeTab(): TabState | null {
    return this.#activeTargetId
      ? (this.#tabs.get(this.#activeTargetId) ?? null)
      : null;
  }

  #tabBySession(cdpSessionId: string): TabState | undefined {
    for (const tab of this.#tabs.values())
      if (tab.cdpSessionId === cdpSessionId) return tab;
    return undefined;
  }

  #send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    cdpSessionId?: string,
  ): Promise<T> {
    return this.#host.send<T>(method, params, cdpSessionId);
  }

  /** The active tab, opening the context and a tab when needed. */
  async requireActiveTab(): Promise<TabState> {
    this.touch();
    await this.#context();
    const existing = this.#activeTab();
    if (existing) return existing;
    await this.newTab("about:blank");
    const tab = this.#activeTab();
    if (!tab) throw new Error("Browser has no page target");
    return tab;
  }

  get viewport(): Viewport {
    return this.#viewport;
  }

  async setViewport(viewport: Viewport): Promise<void> {
    this.touch();
    const next: Viewport = {
      width: Math.max(200, Math.min(4096, Math.round(viewport.width))),
      height: Math.max(200, Math.min(4096, Math.round(viewport.height))),
      deviceScaleFactor: Math.max(1, Math.min(2, viewport.deviceScaleFactor)),
    };
    if (
      next.width === this.#viewport.width &&
      next.height === this.#viewport.height &&
      next.deviceScaleFactor === this.#viewport.deviceScaleFactor
    ) {
      return;
    }
    this.#viewport = next;
    if (!this.isRunning) return;
    for (const tab of this.#tabs.values()) {
      try {
        await this.#applyViewport(tab.cdpSessionId);
      } catch {
        // Tab may be closing.
      }
    }
    const active = this.#activeTab();
    if (active) await this.#restartScreencast(active);
  }

  async #applyViewport(cdpSessionId: string): Promise<void> {
    await this.#send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: this.#viewport.width,
        height: this.#viewport.height,
        deviceScaleFactor: this.#viewport.deviceScaleFactor,
        mobile: false,
      },
      cdpSessionId,
    );
  }

  async #restartScreencast(tab: TabState): Promise<void> {
    try {
      await this.#send("Page.stopScreencast", {}, tab.cdpSessionId);
    } catch {
      // Not started yet.
    }
    await this.#send(
      "Page.startScreencast",
      {
        format: "jpeg",
        quality: 70,
        maxWidth: Math.round(
          this.#viewport.width * this.#viewport.deviceScaleFactor,
        ),
        maxHeight: Math.round(
          this.#viewport.height * this.#viewport.deviceScaleFactor,
        ),
        everyNthFrame: 1,
      },
      tab.cdpSessionId,
    );
  }

  async setActiveTab(targetId: string): Promise<void> {
    this.touch();
    const tab = this.#tabs.get(targetId);
    if (!tab) throw new Error(`No such tab: ${targetId}`);
    const previous = this.#activeTab();
    if (previous && previous.targetId !== targetId) {
      try {
        await this.#send("Page.stopScreencast", {}, previous.cdpSessionId);
      } catch {
        // Previous tab may be gone.
      }
    }
    this.#activeTargetId = targetId;
    this.#lastFrame = null;
    await this.#send("Target.activateTarget", { targetId });
    await this.#restartScreencast(tab);
    this.#onChange();
  }

  async newTab(url: string): Promise<string> {
    this.touch();
    const browserContextId = await this.#context();
    const { targetId } = await this.#send<{ targetId: string }>(
      "Target.createTarget",
      { url, browserContextId },
    );
    // Auto-attach registers the tab; wait for it so the caller can act on it.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !this.#tabs.has(targetId)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.#tabs.has(targetId)) await this.setActiveTab(targetId);
    return targetId;
  }

  async closeTab(targetId: string): Promise<void> {
    this.touch();
    if (!this.#tabs.has(targetId)) throw new Error(`No such tab: ${targetId}`);
    await this.#send("Target.closeTarget", { targetId });
    this.onTargetGone(targetId);
  }

  async navigate(url: string): Promise<void> {
    const tab = await this.requireActiveTab();
    await this.#send("Page.navigate", { url }, tab.cdpSessionId);
  }

  async reload(): Promise<void> {
    const tab = await this.requireActiveTab();
    await this.#send("Page.reload", {}, tab.cdpSessionId);
  }

  async #history(
    cdpSessionId: string,
  ): Promise<{ currentIndex: number; entries: { id: number }[] }> {
    return this.#send("Page.getNavigationHistory", {}, cdpSessionId);
  }

  async goBack(): Promise<void> {
    const tab = await this.requireActiveTab();
    const { currentIndex, entries } = await this.#history(tab.cdpSessionId);
    const entry = entries[currentIndex - 1];
    if (entry)
      await this.#send(
        "Page.navigateToHistoryEntry",
        { entryId: entry.id },
        tab.cdpSessionId,
      );
  }

  async goForward(): Promise<void> {
    const tab = await this.requireActiveTab();
    const { currentIndex, entries } = await this.#history(tab.cdpSessionId);
    const entry = entries[currentIndex + 1];
    if (entry)
      await this.#send(
        "Page.navigateToHistoryEntry",
        { entryId: entry.id },
        tab.cdpSessionId,
      );
  }

  async dispatchInput(event: BrowserInput): Promise<void> {
    const tab = await this.requireActiveTab();
    if (event.kind === "mouse") {
      const { kind: _kind, x, y, ...rest } = event;
      await this.#send(
        "Input.dispatchMouseEvent",
        {
          ...rest,
          x: Math.round(x * this.#viewport.width),
          y: Math.round(y * this.#viewport.height),
        },
        tab.cdpSessionId,
      );
      return;
    }
    const { kind: _kind, ...rest } = event;
    await this.#send("Input.dispatchKeyEvent", rest, tab.cdpSessionId);
  }

  async evaluate(expression: string): Promise<unknown> {
    const tab = await this.requireActiveTab();
    const result = await this.#send<{
      result: { type: string; value?: unknown; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
      tab.cdpSessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value ?? result.result.description ?? null;
  }

  async screenshot(fullPage: boolean): Promise<Buffer> {
    const tab = await this.requireActiveTab();
    const { data } = await this.#send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: fullPage },
      tab.cdpSessionId,
    );
    return Buffer.from(data, "base64");
  }

  /** Writes cookies into this session's context only. */
  async setCookies(cookies: Record<string, unknown>[]): Promise<void> {
    const browserContextId = await this.#context();
    await this.#send("Storage.setCookies", { cookies, browserContextId });
  }

  async status(): Promise<BrowserStatus> {
    const active = this.#activeTab();
    let canGoBack = false;
    let canGoForward = false;
    if (active) {
      try {
        const { currentIndex, entries } = await this.#history(
          active.cdpSessionId,
        );
        canGoBack = currentIndex > 0;
        canGoForward = currentIndex < entries.length - 1;
      } catch {
        // Tab is mid-navigation.
      }
    }
    const tabs: TabSummary[] = [...this.#tabs.values()].map((tab) => ({
      targetId: tab.targetId,
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      active: tab.targetId === this.#activeTargetId,
    }));
    return {
      running: this.isRunning,
      headless: this.#host.headless,
      endpoint: this.#host.endpoint,
      browserContextId: this.browserContextId,
      activeTargetId: this.#activeTargetId,
      viewport: this.#viewport,
      canGoBack,
      canGoForward,
      tabs,
    };
  }
}
