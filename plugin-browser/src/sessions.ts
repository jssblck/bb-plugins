// The session registry: one browsing session per thread, plus their lifetime.
import { ChromeHost } from "./host.ts";
import { BrowserSession } from "./session.ts";

/** Sessions for CLI calls made outside any thread share this key. */
export const SCRATCH_SESSION_KEY = "scratch";

/** How long a session survives with no command and nobody watching it. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const SWEEP_INTERVAL_MS = 60 * 1000;

export interface SessionRegistryOptions {
  host: ChromeHost;
  /** Fires when a session's tabs or navigation state change. */
  onChange: (key: string) => void;
  log: (message: string) => void;
}

export class SessionRegistry {
  #options: SessionRegistryOptions;
  #sessions = new Map<string, BrowserSession>();
  #sweeper: NodeJS.Timeout;

  constructor(options: SessionRegistryOptions) {
    this.#options = options;
    this.#sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.#sweeper.unref?.();
  }

  /** The session for a key, without creating one. */
  peek(key: string): BrowserSession | undefined {
    return this.#sessions.get(key);
  }

  /** The session for a key, created on first use. Counts as activity. */
  require(key: string): BrowserSession {
    const existing = this.#sessions.get(key);
    if (existing) {
      existing.touch();
      return existing;
    }
    const session = new BrowserSession({
      key,
      host: this.#options.host,
      onChange: () => this.#options.onChange(key),
      log: this.#options.log,
    });
    this.#sessions.set(key, session);
    return session;
  }

  async dispose(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) return;
    this.#sessions.delete(key);
    await session.dispose();
    this.#options.onChange(key);
    await this.#stopHostIfUnused();
  }

  /** Closes every session and the Chrome process behind them. */
  async disposeAll(): Promise<void> {
    clearInterval(this.#sweeper);
    this.#sessions.clear();
    await this.#options.host.stop();
  }

  async sweep(): Promise<void> {
    for (const [key, session] of [...this.#sessions]) {
      if (session.viewerCount > 0) continue;
      if (session.idleForMs < IDLE_TIMEOUT_MS) continue;
      this.#options.log(`Closing idle browser session ${key}`);
      await this.dispose(key);
    }
  }

  async #stopHostIfUnused(): Promise<void> {
    for (const session of this.#sessions.values()) {
      if (session.isRunning) return;
    }
    await this.#options.host.stop();
  }
}
