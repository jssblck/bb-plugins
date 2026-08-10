// bb's side of the bridge: a unix socket every connected browser dials into.
//
// One connection is one browser profile running the extension. Chrome starts a
// native host process per extension port, that host connects here, and this
// server correlates the requests bb sends with the responses that come back.
import { createServer, type Server, type Socket } from "node:net";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BrowserConnection {
  readonly id: string;
  readonly version: string;
  readonly connectedAt: number;
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
}

class Connection implements BrowserConnection {
  readonly id: string;
  readonly connectedAt = Date.now();
  version = "unknown";
  #socket: Socket;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #buffer = "";

  constructor(id: string, socket: Socket) {
    this.id = id;
    this.#socket = socket;
  }

  handleData(chunk: Buffer, onHello: () => void): void {
    this.#buffer += chunk.toString("utf8");
    let newline = this.#buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) this.#handleMessage(line, onHello);
      newline = this.#buffer.indexOf("\n");
    }
  }

  #handleMessage(line: string, onHello: () => void): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "hello") {
      this.version = String(message.version ?? "unknown");
      onHello();
      return;
    }
    if (message.type !== "response") return;
    const pending = this.#pending.get(Number(message.id));
    if (!pending) return;
    this.#pending.delete(Number(message.id));
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(String(message.error ?? "Browser command failed")));
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Browser did not answer ${method} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.#socket.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
    });
  }

  fail(reason: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }

  close(): void {
    this.#socket.destroy();
  }
}

export interface BridgeOptions {
  /** Stable file naming the live socket, which the native host reads. */
  pointerPath: string;
  onChange: () => void;
  log: (message: string) => void;
}

export class Bridge {
  #options: BridgeOptions;
  #server: Server | null = null;
  #socketPath: string | null = null;
  #connections = new Map<string, Connection>();
  #counter = 0;

  constructor(options: BridgeOptions) {
    this.#options = options;
  }

  /**
   * Every load binds its own socket file. libuv unlinks a unix socket path
   * when its server handle closes, and bb starts the next load before
   * disposing the old one, so a shared path would have the outgoing instance
   * delete the incoming instance's socket. The pointer file is what stays put.
   */
  async start(): Promise<void> {
    const directory = dirname(this.#options.pointerPath);
    await mkdir(directory, { recursive: true });
    await this.#removeStaleSockets(directory);

    const socketPath = join(directory, `bridge-${process.pid}-${Date.now()}.sock`);
    const server = createServer((socket) => this.#accept(socket));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.#socketPath = socketPath;

    // Rename is atomic, so a host that starts mid-write reads one path or the
    // other, never a truncated file.
    const temporary = `${this.#options.pointerPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ socketPath })}\n`, "utf8");
    await rename(temporary, this.#options.pointerPath);
    this.#options.log(`Bridge listening on ${socketPath}`);
  }

  /** Sockets from a crashed bb are dead files nothing will ever answer on. */
  async #removeStaleSockets(directory: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("bridge-") && entry.endsWith(".sock"))
        .map((entry) => rm(join(directory, entry), { force: true })),
    );
  }

  #accept(socket: Socket): void {
    const id = `browser-${++this.#counter}`;
    const connection = new Connection(id, socket);
    socket.on("data", (chunk) => {
      connection.handleData(chunk, () => {
        this.#connections.set(id, connection);
        this.#options.log(`Browser connected: ${id} (extension ${connection.version})`);
        this.#options.onChange();
      });
    });
    const drop = () => {
      if (!this.#connections.delete(id)) return;
      connection.fail("The browser disconnected");
      this.#options.log(`Browser disconnected: ${id}`);
      this.#options.onChange();
    };
    socket.on("close", drop);
    socket.on("error", drop);
  }

  connections(): BrowserConnection[] {
    return [...this.#connections.values()];
  }

  get(id: string): BrowserConnection | undefined {
    return this.#connections.get(id);
  }

  /** The newest connection, which is the one a fresh Chrome start produced. */
  primary(): BrowserConnection | undefined {
    let newest: Connection | undefined;
    for (const connection of this.#connections.values()) {
      if (!newest || connection.connectedAt > newest.connectedAt) newest = connection;
    }
    return newest;
  }

  async stop(): Promise<void> {
    for (const connection of this.#connections.values()) {
      connection.fail("bb is shutting down");
      connection.close();
    }
    this.#connections.clear();
    const server = this.#server;
    this.#server = null;
    this.#socketPath = null;
    if (!server) return;
    // Closing the handle unlinks this instance's own socket file, and the
    // pointer file already names whichever instance replaced it.
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
