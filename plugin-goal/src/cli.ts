// `bb goal …` — the surface users and agents drive goals with.
//
// Commands act on the calling thread unless `--thread` names another one.
import type {
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
} from "@bb/plugin-sdk";

import {
  DEFAULT_MAX_ITERATIONS,
  flagValue,
  formatGoal,
  GoalInputError,
  normalizeMaxIterations,
  normalizeObjective,
  parseArgs,
  statusLine,
  type Goal,
  type ParsedArgs,
} from "./goal.ts";
import { errorMessage, type GoalService } from "./service.ts";

const VALUE_FLAGS = ["thread", "iterations"] as const;

export function createCliRegistration(
  service: GoalService,
): PluginCliRegistration {
  return {
    name: "goal",
    summary:
      "Give a thread a durable objective it keeps working toward across turns",
    commands: [
      {
        name: "set",
        summary:
          "Set the thread's goal: the outcome, how it is verified, and what must not regress",
        usage: "bb goal set <objective> [--iterations N] [--thread <id>]",
      },
      {
        name: "show",
        summary: "Show the thread's goal, its status, and its iteration count",
        usage: "bb goal show [--thread <id>] [--json]",
      },
      {
        name: "pause",
        summary: "Stop continuing the thread without discarding the goal",
        usage: "bb goal pause [--thread <id>]",
      },
      {
        name: "resume",
        summary: "Resume a paused, budget-limited, or blocked goal",
        usage: "bb goal resume [--iterations N] [--thread <id>]",
      },
      {
        name: "clear",
        summary: "Discard the thread's goal",
        usage: "bb goal clear [--thread <id>]",
      },
      {
        name: "list",
        summary: "List every thread that has a goal",
        usage: "bb goal list [--json]",
      },
    ],
    run: async (argv, context) => {
      try {
        return await runCommand(service, argv, context);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  };
}

async function runCommand(
  service: GoalService,
  argv: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest, VALUE_FLAGS);
  switch (command) {
    case undefined:
    case "show":
      return showCommand(service, args, context);
    case "set":
      return await setCommand(service, args, context);
    case "pause":
      return pauseCommand(service, args, context);
    case "resume":
      return await resumeCommand(service, args, context);
    case "clear":
      return clearCommand(service, args, context);
    case "list":
      return listCommand(service, args);
    case "help":
    case "--help":
    case "-h":
      return ok(HELP);
    default:
      return fail(`Unknown command: ${command}\n\n${HELP}`);
  }
}

const HELP = `bb goal — keep a thread working toward one outcome.

  set <objective> [--iterations N]  Set the goal and start working toward it
  show [--json]                     Show the goal, its status, and iterations
  pause                             Stop continuing the thread
  resume [--iterations N]           Continue the thread again
  clear                             Discard the goal
  list [--json]                     Every thread that has a goal

  --thread <id>                     Act on another thread

A goal states what should be true, how success is checked, and what must not
regress. While it is active, bb continues the thread every time it goes idle,
up to --iterations continuations (default ${DEFAULT_MAX_ITERATIONS}). The agent
ends the goal by calling the goal_report tool with evidence.`;

function showCommand(
  service: GoalService,
  args: ParsedArgs,
  context: PluginCliContext,
): PluginCliResult {
  const threadId = resolveThreadId(args, context);
  const goal = service.get(threadId);
  if (args.flags.has("json")) return ok(JSON.stringify(goal, null, 2));
  if (goal === null) {
    return ok("No goal on this thread. Set one with `bb goal set <objective>`.");
  }
  return ok(formatGoal(goal));
}

async function setCommand(
  service: GoalService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const threadId = resolveThreadId(args, context);
  const objective = normalizeObjective(args.positional.join(" "));
  const iterations = flagValue(args, "iterations");
  const goal = await service.set({
    threadId,
    objective,
    maxIterations:
      iterations === null
        ? DEFAULT_MAX_ITERATIONS
        : normalizeMaxIterations(iterations),
  });
  return ok(
    [
      formatGoal(goal),
      "",
      `bb will continue this thread each time it goes idle, up to ${goal.maxIterations} times.`,
      "Call goal_report with evidence to end it earlier.",
    ].join("\n"),
  );
}

function pauseCommand(
  service: GoalService,
  args: ParsedArgs,
  context: PluginCliContext,
): PluginCliResult {
  const threadId = resolveThreadId(args, context);
  const goal = requireGoal(service, threadId);
  if (goal.status !== "active") {
    return ok(`Goal is already ${goal.status}.`);
  }
  service.setStatus(threadId, "paused", "Paused by the user.");
  return ok("Goal paused. Resume it with `bb goal resume`.");
}

async function resumeCommand(
  service: GoalService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const threadId = resolveThreadId(args, context);
  const goal = requireGoal(service, threadId);
  const iterations = flagValue(args, "iterations");
  const resumed = await service.resume(
    threadId,
    iterations === null ? undefined : normalizeMaxIterations(iterations),
  );
  return ok(formatGoal(resumed ?? goal));
}

function clearCommand(
  service: GoalService,
  args: ParsedArgs,
  context: PluginCliContext,
): PluginCliResult {
  const threadId = resolveThreadId(args, context);
  if (!service.clear(threadId)) return ok("No goal on this thread.");
  return ok("Goal cleared.");
}

function listCommand(service: GoalService, args: ParsedArgs): PluginCliResult {
  const goals = service.list();
  if (args.flags.has("json")) return ok(JSON.stringify(goals, null, 2));
  if (goals.length === 0) return ok("No goals.");
  return ok(
    goals
      .map((goal) => `${goal.threadId}  ${statusLine(goal)}\n  ${firstLine(goal)}`)
      .join("\n"),
  );
}

function firstLine(goal: Goal): string {
  const [line = ""] = goal.objective.split("\n");
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

function requireGoal(service: GoalService, threadId: string): Goal {
  const goal = service.get(threadId);
  if (goal === null) {
    throw new GoalInputError(
      "No goal on this thread. Set one with `bb goal set <objective>`.",
    );
  }
  return goal;
}

function resolveThreadId(args: ParsedArgs, context: PluginCliContext): string {
  const explicit = flagValue(args, "thread");
  if (explicit !== null) return explicit;
  if (context.threadId !== undefined) return context.threadId;
  throw new GoalInputError(
    "This command ran outside a thread. Name one with --thread <id>.",
  );
}

function ok(stdout: string): PluginCliResult {
  return { exitCode: 0, stdout };
}

function fail(stderr: string): PluginCliResult {
  return { exitCode: 1, stderr };
}
