// Which tab a thread drives.
//
// An agent works in one tab of the user's real browser: the one it opened, or
// the one the user handed it. That binding is durable, because a thread comes
// back to its page across turns and restarts, and it is verified on every use,
// because the user can close the tab at any time.
import type { Bridge, BrowserConnection } from "./bridge.ts";

export interface TabBinding {
  browserId: string;
  tabId: number;
}

export interface TabSummary {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  loading: boolean;
}

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const key = (sessionKey: string) => `tab:${sessionKey}`;

export class TabRegistry {
  #bridge: Bridge;
  #kv: KvStore;
  #onChange: (sessionKey: string) => void;

  constructor(options: {
    bridge: Bridge;
    kv: KvStore;
    onChange: (sessionKey: string) => void;
  }) {
    this.#bridge = options.bridge;
    this.#kv = options.kv;
    this.#onChange = options.onChange;
  }

  /** The connection a binding names, falling back to the only browser there is. */
  #connectionFor(binding: TabBinding | undefined): BrowserConnection | undefined {
    if (binding) {
      const exact = this.#bridge.get(binding.browserId);
      if (exact) return exact;
    }
    return this.#bridge.primary();
  }

  connection(): BrowserConnection {
    const connection = this.#bridge.primary();
    if (!connection) {
      throw new Error(
        "No browser is connected. Open Chrome with the bb Browser extension enabled, then run `bb browser status`.",
      );
    }
    return connection;
  }

  async binding(sessionKey: string): Promise<TabBinding | undefined> {
    return this.#kv.get<TabBinding>(key(sessionKey));
  }

  async bind(sessionKey: string, binding: TabBinding): Promise<void> {
    await this.#kv.set(key(sessionKey), binding);
    this.#onChange(sessionKey);
  }

  async release(sessionKey: string): Promise<TabBinding | undefined> {
    const binding = await this.binding(sessionKey);
    await this.#kv.delete(key(sessionKey));
    if (binding) {
      const connection = this.#connectionFor(binding);
      // Dropping the debug session takes the banner off the user's tab.
      await connection
        ?.request("tabs.release", { tabId: binding.tabId })
        .catch(() => undefined);
    }
    this.#onChange(sessionKey);
    return binding;
  }

  /** The bound tab, checked against the live browser before it is used. */
  async resolve(
    sessionKey: string,
  ): Promise<{ connection: BrowserConnection; tabId: number } | undefined> {
    const binding = await this.binding(sessionKey);
    if (!binding) return undefined;
    const connection = this.#connectionFor(binding);
    if (!connection) return undefined;
    try {
      await connection.request<TabSummary>("tabs.get", { tabId: binding.tabId });
    } catch {
      // The user closed it, or Chrome restarted and reissued the id.
      await this.#kv.delete(key(sessionKey));
      this.#onChange(sessionKey);
      return undefined;
    }
    return { connection, tabId: binding.tabId };
  }

  async require(
    sessionKey: string,
  ): Promise<{ connection: BrowserConnection; tabId: number }> {
    const resolved = await this.resolve(sessionKey);
    if (resolved) return resolved;
    throw new Error(
      "This thread has no browser tab. Open one with `bb browser open <url>`, or claim an existing tab with `bb browser attach <tabId>`.",
    );
  }

  /** Opens a tab for this thread, reusing the bound one when it still exists. */
  async open(
    sessionKey: string,
    url: string,
    options: { active?: boolean } = {},
  ): Promise<TabSummary> {
    const existing = await this.resolve(sessionKey);
    if (existing) {
      return existing.connection.request<TabSummary>("tabs.navigate", {
        tabId: existing.tabId,
        url,
      });
    }
    const connection = this.connection();
    const tab = await connection.request<TabSummary>("tabs.open", {
      url,
      active: options.active ?? false,
    });
    await this.bind(sessionKey, { browserId: connection.id, tabId: tab.tabId });
    return tab;
  }

  async attach(sessionKey: string, tabId: number): Promise<TabSummary> {
    const connection = this.connection();
    const tab = await connection.request<TabSummary>("tabs.get", { tabId });
    await this.bind(sessionKey, { browserId: connection.id, tabId });
    return tab;
  }
}
