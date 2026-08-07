// A minimal Chrome DevTools Protocol client over the browser-level WebSocket.
//
// Sessions are "flat": every request and event carries an optional sessionId on
// the single socket, so one connection drives the browser target and all of its
// page targets.

interface CdpFrame {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: string };
  sessionId?: string;
}

export type CdpEventHandler = (
  params: Record<string, unknown>,
  sessionId: string | undefined,
) => void;

export class CdpError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = "CdpError";
  }
}

export class CdpConnection {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<
    number,
    {
      method: string;
      resolve: (value: never) => void;
      reject: (error: Error) => void;
    }
  >();
  #handlers = new Map<string, Set<CdpEventHandler>>();
  #closedWith: Error | null = null;

  /** Fires once when the socket closes for any reason, including close(). */
  onClosed: (() => void) | undefined;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.onmessage = (event) => this.#receive(String(event.data));
    socket.onclose = () => this.#fail(new Error("CDP connection closed"));
    socket.onerror = () => this.#fail(new Error("CDP connection errored"));
  }

  static connect(url: string, timeoutMs = 15_000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to ${url}`));
      }, timeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket));
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Failed to connect to ${url}`));
      };
    });
  }

  get isOpen(): boolean {
    return (
      this.#closedWith === null && this.#socket.readyState === WebSocket.OPEN
    );
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (this.#closedWith) return Promise.reject(this.#closedWith);
    const id = this.#nextId++;
    const frame: CdpFrame = { id, method, params };
    if (sessionId) frame.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        method,
        resolve: resolve as (value: never) => void,
        reject,
      });
      try {
        this.#socket.send(JSON.stringify(frame));
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  on(method: string, handler: CdpEventHandler): () => void {
    let handlers = this.#handlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  close(): void {
    this.#fail(new Error("CDP connection closed"));
    try {
      this.#socket.close();
    } catch {
      // Already closing.
    }
  }

  #receive(raw: string): void {
    let frame: CdpFrame;
    try {
      frame = JSON.parse(raw) as CdpFrame;
    } catch {
      return;
    }
    if (typeof frame.id === "number") {
      const pending = this.#pending.get(frame.id);
      if (!pending) return;
      this.#pending.delete(frame.id);
      if (frame.error) {
        pending.reject(
          new CdpError(pending.method, frame.error.code, frame.error.message),
        );
      } else {
        pending.resolve(frame.result as never);
      }
      return;
    }
    if (!frame.method) return;
    const handlers = this.#handlers.get(frame.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(frame.params ?? {}, frame.sessionId);
      } catch {
        // A listener must never break protocol dispatch.
      }
    }
  }

  #fail(error: Error): void {
    if (this.#closedWith) return;
    this.#closedWith = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#handlers.clear();
    const notify = this.onClosed;
    this.onClosed = undefined;
    notify?.();
  }
}
