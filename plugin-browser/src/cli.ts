// `bb browser …` — the agent-facing surface.
//
// Commands act on the calling thread's browser session, which a spawned child
// thread shares with its parent. A call made outside a thread lands on a
// shared scratch session instead.
import { isAbsolute, resolve } from "node:path";

import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
} from "@bb/plugin-sdk";

import { importChromeCookies, readChromeCookies } from "./cookie-import.ts";
import { filterByDomains } from "./cookies.ts";
import type { SessionKeyResolver } from "./session-key.ts";
import type { BrowserSession } from "./session.ts";
import type { SessionRegistry } from "./sessions.ts";
import { normalizeUrl } from "./url.ts";

/** Keeps `text` and `html` output well under the plugin CLI output ceiling. */
const MAX_EXTRACT_CHARS = 200_000;

export interface CliDeps {
  bb: BbPluginApi;
  sessions: SessionRegistry;
  resolveSessionKey: SessionKeyResolver;
  cookieProfile: () => Promise<string>;
}

export function createCliRegistration(deps: CliDeps): PluginCliRegistration {
  return {
    name: "browser",
    summary:
      "Drive this thread's browser session and its Chrome DevTools Protocol endpoint",
    commands: [
      {
        name: "status",
        summary:
          "Show whether this thread's browser is running, its tabs, and its CDP endpoint",
        usage: "bb browser status [--json]",
      },
      {
        name: "cdp",
        summary:
          "Print the CDP endpoint and this thread's browser context id, for Playwright or Puppeteer",
        usage: "bb browser cdp [--json]",
      },
      {
        name: "open",
        summary: "Navigate the active tab, starting the browser when needed",
        usage: "bb browser open <url>",
      },
      {
        name: "tabs",
        summary: "List this thread's open tabs",
        usage: "bb browser tabs [--json]",
      },
      {
        name: "new",
        summary: "Open a URL in a new tab",
        usage: "bb browser new [url]",
      },
      {
        name: "close",
        summary: "Close a tab by target id",
        usage: "bb browser close <targetId>",
      },
      {
        name: "select",
        summary: "Make a tab active, which is the tab the browser view shows",
        usage: "bb browser select <targetId>",
      },
      {
        name: "eval",
        summary:
          "Evaluate a JavaScript expression in the active tab and print the JSON result",
        usage: "bb browser eval <expression>",
      },
      {
        name: "text",
        summary: "Print the rendered text of the active tab",
        usage: "bb browser text",
      },
      {
        name: "html",
        summary: "Print the HTML of the active tab",
        usage: "bb browser html",
      },
      {
        name: "screenshot",
        summary:
          "Write a PNG of the active tab to a path on the calling machine",
        usage: "bb browser screenshot <path> [--full-page]",
      },
      {
        name: "cookies",
        summary:
          "Copy session cookies from the user's own Chrome into this thread's browser, or list their names",
        usage: "bb browser cookies import|list [domain...]",
      },
      {
        name: "stop",
        summary: "Close this thread's browser session",
        usage: "bb browser stop",
      },
    ],
    run: (argv, context) => runCommand(deps, argv, context),
  };
}

async function runCommand(
  deps: CliDeps,
  argv: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const [command, ...rest] = argv;
  const key = await deps.resolveSessionKey(context.threadId);
  const session = deps.sessions.require(key);
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return ok(HELP);
      case "status":
        return await statusCommand(session, rest);
      case "cdp":
        return await cdpCommand(session, rest);
      case "open":
        return await openCommand(session, rest);
      case "tabs":
        return await tabsCommand(session, rest);
      case "new":
        return await newCommand(session, rest);
      case "close":
        return await closeCommand(session, rest);
      case "select":
        return await selectCommand(session, rest);
      case "eval":
        return await evalCommand(session, rest);
      case "text":
        return await extractCommand(session, "text");
      case "html":
        return await extractCommand(session, "html");
      case "screenshot":
        return await screenshotCommand(deps, session, rest, context);
      case "cookies":
        return await cookiesCommand(deps, session, rest);
      case "stop":
        await deps.sessions.dispose(key);
        return ok("Browser session closed.");
      default:
        return fail(`Unknown command: ${command}\n\n${HELP}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const HELP = `bb browser — drive this thread's browser session.

  status [--json]              Running state, tabs, and CDP endpoint
  cdp [--json]                 CDP endpoint and browser context id
  open <url>                   Navigate the active tab
  tabs [--json]                List open tabs
  new [url]                    Open a new tab
  close <targetId>             Close a tab
  select <targetId>            Make a tab active
  eval <expression>            Evaluate JavaScript in the active tab
  text                         Rendered text of the active tab
  html                         HTML of the active tab
  screenshot <path> [--full-page]
  cookies import [domain...]   Copy cookies from the user's own Chrome
  cookies list [domain...]     List cookie names in the user's Chrome
  stop                         Close this thread's session

Your session's tabs, cookies, and viewport are isolated from other threads', but
a thread you spawn shares yours. The browser is a separate Chrome profile, not
the user's own browser; use \`cookies import\` to make it share the user's
logged-in sessions.`;

function ok(stdout: string): PluginCliResult {
  return { exitCode: 0, stdout };
}

function fail(stderr: string): PluginCliResult {
  return { exitCode: 1, stderr };
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

async function statusCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const status = await session.status();
  if (wantsJson(args)) return ok(JSON.stringify(status, null, 2));
  if (!status.running) return ok("Browser: stopped");
  const lines = [
    `Browser: running (${status.headless ? "headless" : "windowed"})`,
    `CDP:     ${status.endpoint?.browserWsUrl ?? "unknown"}`,
    `Context: ${status.browserContextId ?? "unknown"}`,
    `Viewport: ${status.viewport.width}x${status.viewport.height}`,
    "",
    ...status.tabs.map(
      (tab) =>
        `${tab.active ? "*" : " "} ${tab.targetId}  ${tab.loading ? "[loading] " : ""}${tab.url}`,
    ),
  ];
  return ok(lines.join("\n"));
}

async function cdpCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const tab = await session.requireActiveTab();
  const status = await session.status();
  if (!status.endpoint) return fail("Browser is not running.");
  const payload = {
    browserWsUrl: status.endpoint.browserWsUrl,
    httpUrl: `http://127.0.0.1:${status.endpoint.port}`,
    port: status.endpoint.port,
    browserContextId: status.browserContextId,
    activeTargetId: tab.targetId,
  };
  if (wantsJson(args)) return ok(JSON.stringify(payload, null, 2));
  return ok(
    [
      payload.browserWsUrl,
      "",
      "Connect with Playwright:  chromium.connectOverCDP('" +
        payload.httpUrl +
        "')",
      "Connect with Puppeteer:   puppeteer.connect({ browserWSEndpoint: '" +
        payload.browserWsUrl +
        "' })",
      "",
      "One Chrome serves every thread, so an attach sees other threads'",
      "contexts too. Keep to this thread's own context:",
      `  browserContextId: ${payload.browserContextId}`,
      `  active targetId:  ${payload.activeTargetId}`,
    ].join("\n"),
  );
}

async function openCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const url = args[0];
  if (!url) return fail("Usage: bb browser open <url>");
  await session.navigate(normalizeUrl(url));
  return ok(`Navigating to ${normalizeUrl(url)}`);
}

async function tabsCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const { tabs } = await session.status();
  if (wantsJson(args)) return ok(JSON.stringify(tabs, null, 2));
  if (tabs.length === 0) return ok("No open tabs.");
  return ok(
    tabs
      .map(
        (tab) =>
          `${tab.active ? "*" : " "} ${tab.targetId}  ${tab.title || tab.url}\n    ${tab.url}`,
      )
      .join("\n"),
  );
}

async function newCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const targetId = await session.newTab(
    args[0] ? normalizeUrl(args[0]) : "about:blank",
  );
  return ok(targetId);
}

async function closeCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const targetId = args[0];
  if (!targetId) return fail("Usage: bb browser close <targetId>");
  await session.closeTab(targetId);
  return ok(`Closed ${targetId}`);
}

async function selectCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const targetId = args[0];
  if (!targetId) return fail("Usage: bb browser select <targetId>");
  await session.setActiveTab(targetId);
  return ok(`Active tab is now ${targetId}`);
}

async function evalCommand(
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const expression = args.join(" ");
  if (!expression) return fail("Usage: bb browser eval <expression>");
  const value = await session.evaluate(expression);
  return ok(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function extractCommand(
  session: BrowserSession,
  kind: "text" | "html",
): Promise<PluginCliResult> {
  const expression =
    kind === "text"
      ? "document.body ? document.body.innerText : ''"
      : "document.documentElement ? document.documentElement.outerHTML : ''";
  const value = String((await session.evaluate(expression)) ?? "");
  if (value.length <= MAX_EXTRACT_CHARS) return ok(value);
  return ok(
    `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[truncated at ${MAX_EXTRACT_CHARS} characters of ${value.length}]`,
  );
}

async function screenshotCommand(
  deps: CliDeps,
  session: BrowserSession,
  args: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const fullPage = args.includes("--full-page");
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) return fail("Usage: bb browser screenshot <path> [--full-page]");

  const png = await session.screenshot(fullPage);
  // `run` executes on the server, so the path names a file on the machine that
  // invoked the CLI. Route the write through the SDK with that host id.
  const hostId = await resolveCallerHostId(deps.bb, context);
  const path = isAbsolute(target)
    ? target
    : resolve(context.cwd ?? process.cwd(), target);
  const result = await deps.bb.sdk.files.write({
    hostId,
    path,
    content: png.toString("base64"),
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

async function cookiesCommand(
  deps: CliDeps,
  session: BrowserSession,
  args: string[],
): Promise<PluginCliResult> {
  const [action, ...domains] = args;
  const profile = await deps.cookieProfile();
  const filters = domains.filter((domain) => !domain.startsWith("--"));

  if (action === "import") {
    const result = await importChromeCookies(session, {
      domains: filters,
      profile,
    });
    const lines = [
      `Imported ${result.imported} of ${result.scanned} cookies from ${describeSource(result)}.`,
    ];
    if (result.fallbackReason)
      lines.push(`Profile database unavailable: ${result.fallbackReason}`);
    if (result.domains.length > 0) {
      lines.push(`Domains: ${result.domains.slice(0, 40).join(", ")}`);
    }
    return ok(lines.join("\n"));
  }

  if (action === "list") {
    const result = await readChromeCookies({ domains: filters, profile });
    const selected = filterByDomains(result.cookies, filters);
    const lines = selected
      .map((cookie) => `${cookie.domain}\t${cookie.name}`)
      .sort()
      .slice(0, 2000);
    return ok(
      [
        `${selected.length} cookies from ${describeSource(result)} (values omitted)`,
        "",
        ...lines,
      ].join("\n"),
    );
  }

  return fail("Usage: bb browser cookies import|list [domain...]");
}

function describeSource(result: {
  source: string;
  profile: string | null;
}): string {
  return result.source === "profile-database"
    ? `the "${result.profile}" profile database`
    : "the running Chrome";
}
