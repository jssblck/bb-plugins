// `bb browser …` — the agent-facing surface.
//
// Commands act on the tab bound to the calling thread, in the user's own
// Chrome. A spawned child thread shares its parent's tab; a call made outside
// a thread lands on a shared scratch binding.
import { isAbsolute, resolve } from "node:path";

import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
} from "@bb/plugin-sdk";

import type { Bridge } from "./bridge.ts";
import { EXTENSION_ID, extensionDir, install, type InstallPaths } from "./install.ts";
import type { SessionKeyResolver } from "./session-key.ts";
import { TabRegistry, type TabSummary } from "./tabs.ts";
import { normalizeUrl } from "./url.ts";

/** Keeps `text` and `html` output well under the plugin CLI output ceiling. */
const MAX_EXTRACT_CHARS = 200_000;

export interface CliDeps {
  bb: BbPluginApi;
  bridge: Bridge;
  tabs: TabRegistry;
  resolveSessionKey: SessionKeyResolver;
  installPaths: InstallPaths;
}

export function createCliRegistration(deps: CliDeps): PluginCliRegistration {
  return {
    name: "browser",
    summary: "Drive the user's own Chrome through the bb Browser extension",
    commands: [
      {
        name: "status",
        summary: "Show the connected browser and the tab this thread drives",
        usage: "bb browser status [--json]",
      },
      {
        name: "install",
        summary:
          "Write the native messaging manifest and print how to load the extension",
        usage: "bb browser install",
      },
      {
        name: "open",
        summary:
          "Open a URL in this thread's tab, creating and claiming one when needed",
        usage: "bb browser open <url> [--show]",
      },
      {
        name: "tabs",
        summary: "List every tab open in the user's browser",
        usage: "bb browser tabs [--json]",
      },
      {
        name: "attach",
        summary: "Claim one of the user's existing tabs for this thread",
        usage: "bb browser attach <tabId>",
      },
      {
        name: "release",
        summary: "Let go of this thread's tab, leaving it open for the user",
        usage: "bb browser release",
      },
      {
        name: "close",
        summary: "Close this thread's tab",
        usage: "bb browser close",
      },
      {
        name: "show",
        summary: "Bring this thread's tab to the front of the user's screen",
        usage: "bb browser show",
      },
      {
        name: "reload",
        summary: "Reload this thread's tab",
        usage: "bb browser reload",
      },
      {
        name: "text",
        summary: "Print the rendered text of this thread's tab",
        usage: "bb browser text",
      },
      {
        name: "html",
        summary: "Print the HTML of this thread's tab",
        usage: "bb browser html",
      },
      {
        name: "eval",
        summary:
          "Evaluate a JavaScript expression in this thread's tab and print the JSON result",
        usage: "bb browser eval <expression>",
      },
      {
        name: "click",
        summary: "Click the first element matching a CSS selector",
        usage: "bb browser click <selector>",
      },
      {
        name: "type",
        summary: "Type text into the element matching a CSS selector",
        usage: "bb browser type <selector> <text> [--submit]",
      },
      {
        name: "press",
        summary: "Press a key, such as Enter, Tab, Escape, or ArrowDown",
        usage: "bb browser press <key>",
      },
      {
        name: "scroll",
        summary: "Scroll the page down, or up with --up",
        usage: "bb browser scroll [--up] [--amount <pixels>]",
      },
      {
        name: "wait",
        summary: "Wait until a CSS selector matches something on the page",
        usage: "bb browser wait <selector> [--timeout <ms>]",
      },
      {
        name: "screenshot",
        summary: "Write a PNG of this thread's tab to a path on the calling machine",
        usage: "bb browser screenshot <path> [--full-page]",
      },
    ],
    run: (argv, context) => runCommand(deps, argv, context),
  };
}

const HELP = `bb browser — drive the user's own Chrome.

  status [--json]              Connected browser and this thread's tab
  install                      Set up the native messaging host
  open <url> [--show]          Open or navigate this thread's tab
  tabs [--json]                List the user's open tabs
  attach <tabId>               Claim an existing tab for this thread
  release                      Let go of the tab, leaving it open
  close                        Close this thread's tab
  show                         Bring the tab to the front
  reload                       Reload the tab
  text                         Rendered text of the page
  html                         HTML of the page
  eval <expression>            Evaluate JavaScript in the page
  click <selector>             Click an element
  type <selector> <text> [--submit]
  press <key>                  Enter, Tab, Escape, ArrowUp/Down/Left/Right, …
  scroll [--up] [--amount <pixels>]
  wait <selector> [--timeout <ms>]
  screenshot <path> [--full-page]

This is the user's real browser, signed in as they are. Pages you open start in
the background; \`show\` brings one to the front. Tabs you did not open belong
to the user until you \`attach\` one, and \`release\` hands it back.`;

async function runCommand(
  deps: CliDeps,
  argv: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const [command, ...rest] = argv;
  const sessionKey = await deps.resolveSessionKey(context.threadId);
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return ok(HELP);
      case "status":
        return await statusCommand(deps, sessionKey, rest);
      case "install":
        return await installCommand(deps);
      case "tabs":
        return await tabsCommand(deps, rest);
      case "open":
        return await openCommand(deps, sessionKey, rest);
      case "attach":
        return await attachCommand(deps, sessionKey, rest);
      case "release": {
        const binding = await deps.tabs.release(sessionKey);
        return ok(binding ? `Released tab ${binding.tabId}.` : "No tab was bound.");
      }
      case "close": {
        const { connection, tabId } = await deps.tabs.require(sessionKey);
        await connection.request("tabs.close", { tabId });
        await deps.tabs.release(sessionKey);
        return ok(`Closed tab ${tabId}.`);
      }
      case "show": {
        const { connection, tabId } = await deps.tabs.require(sessionKey);
        const tab = await connection.request<TabSummary>("tabs.select", { tabId });
        return ok(`Showing ${tab.url}`);
      }
      case "reload": {
        const { connection, tabId } = await deps.tabs.require(sessionKey);
        const tab = await connection.request<TabSummary>("tabs.reload", { tabId });
        return ok(`Reloaded ${tab.url}`);
      }
      case "text":
        return await extractCommand(deps, sessionKey, "text");
      case "html":
        return await extractCommand(deps, sessionKey, "html");
      case "eval":
        return await evalCommand(deps, sessionKey, rest);
      case "click":
        return await clickCommand(deps, sessionKey, rest);
      case "type":
        return await typeCommand(deps, sessionKey, rest);
      case "press":
        return await pressCommand(deps, sessionKey, rest);
      case "scroll":
        return await scrollCommand(deps, sessionKey, rest);
      case "wait":
        return await waitCommand(deps, sessionKey, rest);
      case "screenshot":
        return await screenshotCommand(deps, sessionKey, rest, context);
      default:
        return fail(`Unknown command: ${command}\n\n${HELP}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function ok(stdout: string): PluginCliResult {
  return { exitCode: 0, stdout };
}

function fail(stderr: string): PluginCliResult {
  return { exitCode: 1, stderr };
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      out.push(arg);
      continue;
    }
    // Flags that take a value swallow the next argument.
    if (arg === "--timeout" || arg === "--amount") index++;
  }
  return out;
}

async function statusCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const connections = deps.bridge.connections();
  const binding = await deps.tabs.binding(sessionKey);
  const resolved = await deps.tabs.resolve(sessionKey);
  let tab: TabSummary | null = null;
  if (resolved) {
    tab = await resolved.connection.request<TabSummary>("tabs.get", {
      tabId: resolved.tabId,
    });
  }

  if (wantsJson(args)) {
    return ok(
      JSON.stringify(
        {
          connected: connections.length > 0,
          browsers: connections.map((connection) => ({
            id: connection.id,
            version: connection.version,
          })),
          sessionKey,
          binding: binding ?? null,
          tab,
        },
        null,
        2,
      ),
    );
  }

  if (connections.length === 0) {
    return ok(
      [
        "Browser: not connected",
        "",
        "Start Chrome with the bb Browser extension enabled. If you have not",
        "set it up yet, run `bb browser install`.",
      ].join("\n"),
    );
  }

  const lines = [
    `Browser: connected (${connections.length} profile${connections.length === 1 ? "" : "s"}, extension ${connections[0]!.version})`,
    tab
      ? `Tab:     ${tab.tabId}  ${tab.loading ? "[loading] " : ""}${tab.url}`
      : "Tab:     none bound (use `bb browser open <url>`)",
  ];
  if (tab?.title) lines.push(`Title:   ${tab.title}`);
  return ok(lines.join("\n"));
}

async function installCommand(deps: CliDeps): Promise<PluginCliResult> {
  const result = await install(deps.installPaths);
  const lines = [
    "Native messaging host installed:",
    `  ${result.wrapperPath}`,
    "",
    ...result.manifests.map((entry) => `  ${entry.browser}: ${entry.path}`),
    "",
    "Now load the extension:",
    "  1. Open chrome://extensions",
    "  2. Turn on Developer mode",
    "  3. Load unpacked, and choose:",
    `     ${extensionDir()}`,
    "",
    `The extension id is pinned to ${EXTENSION_ID}, which is what the manifest`,
    "allows, so the folder can live anywhere.",
    "",
    "Then run `bb browser status` to confirm the connection.",
  ];
  if (result.missing.length > 0) {
    lines.push("", `Not installed, so skipped: ${result.missing.join(", ")}`);
  }
  return ok(lines.join("\n"));
}

async function tabsCommand(deps: CliDeps, args: string[]): Promise<PluginCliResult> {
  const connection = deps.tabs.connection();
  const { tabs } = await connection.request<{ tabs: TabSummary[] }>("tabs.list");
  if (wantsJson(args)) return ok(JSON.stringify(tabs, null, 2));
  if (tabs.length === 0) return ok("No open tabs.");
  return ok(
    tabs
      .map(
        (tab) =>
          `${tab.active ? "*" : " "} ${tab.tabId}  ${tab.title || tab.url}\n    ${tab.url}`,
      )
      .join("\n"),
  );
}

async function openCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const [url] = positional(args);
  if (!url) return fail("Usage: bb browser open <url> [--show]");
  const target = normalizeUrl(url);
  const tab = await deps.tabs.open(sessionKey, target, {
    active: args.includes("--show"),
  });
  return ok(`Tab ${tab.tabId}: ${tab.url}`);
}

async function attachCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const [raw] = positional(args);
  const tabId = Number(raw);
  if (!Number.isInteger(tabId)) {
    return fail("Usage: bb browser attach <tabId>   (see `bb browser tabs`)");
  }
  const tab = await deps.tabs.attach(sessionKey, tabId);
  return ok(`Attached to tab ${tab.tabId}: ${tab.url}`);
}

async function extractCommand(
  deps: CliDeps,
  sessionKey: string,
  kind: "text" | "html",
): Promise<PluginCliResult> {
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  const result = await connection.request<{ text?: string; html?: string }>(
    kind === "text" ? "page.text" : "page.html",
    { tabId },
  );
  const value = String((kind === "text" ? result.text : result.html) ?? "");
  if (value.length <= MAX_EXTRACT_CHARS) return ok(value);
  return ok(
    `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[truncated at ${MAX_EXTRACT_CHARS} characters of ${value.length}]`,
  );
}

async function evalCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const expression = args.join(" ");
  if (!expression) return fail("Usage: bb browser eval <expression>");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  const { value } = await connection.request<{ value: unknown }>("page.eval", {
    tabId,
    expression,
  });
  return ok(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function clickCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const selector = positional(args).join(" ");
  if (!selector) return fail("Usage: bb browser click <selector>");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  await connection.request("input.click", { tabId, selector });
  return ok(`Clicked ${selector}`);
}

async function typeCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const [selector, ...words] = positional(args);
  const text = words.join(" ");
  if (!selector || !text) {
    return fail("Usage: bb browser type <selector> <text> [--submit]");
  }
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  await connection.request("input.type", {
    tabId,
    selector,
    text,
    submit: args.includes("--submit"),
  });
  return ok(`Typed ${text.length} characters into ${selector}`);
}

async function pressCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const [key] = positional(args);
  if (!key) return fail("Usage: bb browser press <key>");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  await connection.request("input.press", { tabId, key });
  return ok(`Pressed ${key}`);
}

async function scrollCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const amount = Number(flagValue(args, "--amount") ?? 600);
  if (!Number.isFinite(amount)) return fail("--amount takes a number of pixels");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  await connection.request("input.scroll", {
    tabId,
    deltaY: args.includes("--up") ? -amount : amount,
  });
  return ok(args.includes("--up") ? `Scrolled up ${amount}px` : `Scrolled down ${amount}px`);
}

async function waitCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
): Promise<PluginCliResult> {
  const selector = positional(args).join(" ");
  if (!selector) return fail("Usage: bb browser wait <selector> [--timeout <ms>]");
  const timeoutMs = Number(flagValue(args, "--timeout") ?? 10_000);
  if (!Number.isFinite(timeoutMs)) return fail("--timeout takes milliseconds");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  await connection.request(
    "page.wait",
    { tabId, selector, timeoutMs },
    // Outlive the in-page poll so the browser reports the timeout, not bb.
    timeoutMs + 5_000,
  );
  return ok(`Found ${selector}`);
}

async function screenshotCommand(
  deps: CliDeps,
  sessionKey: string,
  args: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const [target] = positional(args);
  if (!target) return fail("Usage: bb browser screenshot <path> [--full-page]");
  const { connection, tabId } = await deps.tabs.require(sessionKey);
  const { data } = await connection.request<{ data: string }>("page.screenshot", {
    tabId,
    fullPage: args.includes("--full-page"),
  });

  // `run` executes on the server, so the path names a file on the machine that
  // invoked the CLI. Route the write through the SDK with that host id.
  const hostId = await resolveCallerHostId(deps.bb, context);
  const path = isAbsolute(target)
    ? target
    : resolve(context.cwd ?? process.cwd(), target);
  const result = await deps.bb.sdk.files.write({
    hostId,
    path,
    content: data,
    contentEncoding: "base64",
    createParents: true,
  });
  if (result.outcome !== "written") {
    return fail(`Could not write ${path}: ${result.outcome}`);
  }
  return ok(`Wrote ${result.sizeBytes} bytes to ${path}`);
}

async function resolveCallerHostId(
  bb: BbPluginApi,
  context: PluginCliContext,
): Promise<string | undefined> {
  if (!context.threadId) return undefined;
  try {
    const thread = await bb.sdk.threads.get({ threadId: context.threadId });
    const environmentId = thread.environmentId;
    if (!environmentId) return undefined;
    const environment = await bb.sdk.environments.get({ environmentId });
    return environment.hostId ?? undefined;
  } catch {
    return undefined;
  }
}
