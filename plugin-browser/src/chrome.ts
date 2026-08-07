// Locating and launching the Chrome binary that backs the managed browser.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MACOS_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

/** Absolute path to a Chromium-family binary, or null when none is installed. */
export function findChromeBinary(): string | null {
  const candidates =
    process.platform === "darwin"
      ? MACOS_CANDIDATES
      : process.platform === "linux"
        ? LINUX_CANDIDATES
        : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** The user-data-dir of the user's own Chrome, where their real cookies live. */
export function realChromeUserDataDir(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Google", "Chrome");
  }
  return join(home, ".config", "google-chrome");
}

export interface DevToolsEndpoint {
  port: number;
  /** Browser-target WebSocket path, e.g. /devtools/browser/<uuid>. */
  path: string;
  browserWsUrl: string;
}

/**
 * Read the DevToolsActivePort file Chrome writes into its user-data-dir. Its
 * two lines are the port and the browser-target WebSocket path; the path acts
 * as a capability token, so only processes that can read this file can attach.
 */
export async function readDevToolsEndpoint(
  userDataDir: string,
): Promise<DevToolsEndpoint | null> {
  let raw: string;
  try {
    raw = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8");
  } catch {
    return null;
  }
  const [portLine, pathLine] = raw.split("\n");
  const port = Number.parseInt(portLine ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) return null;
  const path = (pathLine ?? "").trim() || "/devtools/browser";
  return { port, path, browserWsUrl: `ws://127.0.0.1:${port}${path}` };
}

export interface LaunchOptions {
  binary: string;
  userDataDir: string;
  headless: boolean;
  windowSize: { width: number; height: number };
}

export interface LaunchedChrome {
  child: ChildProcess;
  endpoint: DevToolsEndpoint;
}

export async function launchChrome(
  options: LaunchOptions,
): Promise<LaunchedChrome> {
  const { binary, userDataDir, headless, windowSize } = options;
  await mkdir(userDataDir, { recursive: true });
  // Stale from a previous run: Chrome rewrites it, and we poll for the rewrite.
  await rm(join(userDataDir, "DevToolsActivePort"), { force: true });

  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-service-autorun",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider",
    // Keeps the managed profile out of the system keyring, so launching it
    // never raises a Keychain prompt.
    "--password-store=basic",
    "--use-mock-keychain",
    `--window-size=${windowSize.width},${windowSize.height}`,
  ];
  if (headless) args.push("--headless=new", "--hide-scrollbars");
  args.push("about:blank");

  const child = spawn(binary, args, { stdio: "ignore", detached: false });
  // An unhandled 'error' event on a ChildProcess throws, so the spawn failure
  // races the poll rather than sitting out its timeout.
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", (error) =>
      reject(new Error(`Could not start Chrome: ${error.message}`)),
    );
  });

  try {
    const endpoint = await Promise.race([
      pollForEndpoint(child, userDataDir),
      spawnFailure,
    ]);
    return { child, endpoint };
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function pollForEndpoint(
  child: ChildProcess,
  userDataDir: string,
): Promise<DevToolsEndpoint> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before the debugging port opened (code ${child.exitCode}, signal ${child.signalCode})`,
      );
    }
    const endpoint = await readDevToolsEndpoint(userDataDir);
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome did not report a debugging port within 30s");
}
