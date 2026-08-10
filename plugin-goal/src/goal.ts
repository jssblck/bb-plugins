// The goal model and every pure decision made about it. The factory, the
// store, and the CLI stay thin wrappers around this file so the interesting
// behavior is testable without a bb server.

/** How a goal ended, or that it is still running. */
export type GoalStatus =
  | "active"
  | "paused"
  | "budget-limited"
  | "complete"
  | "blocked";

export interface Goal {
  threadId: string;
  projectId: string;
  /** What must be true, how it is verified, and what must not regress. */
  objective: string;
  status: GoalStatus;
  /** Continuations already sent for this goal. */
  iterations: number;
  /** Continuation ceiling; the goal stops itself here. */
  maxIterations: number;
  /** Evidence for a complete goal, or the reason a blocked one stopped. */
  outcome: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Realtime channel the backend signals on; the thread header refetches. */
export const GOAL_CHANGED_CHANNEL = "goal-changed";

export const DEFAULT_MAX_ITERATIONS = 10;
export const MAX_ITERATIONS_CEILING = 200;
/** Keeps a pathological objective out of every turn's instruction block. */
export const MAX_OBJECTIVE_CHARS = 2000;

/** Whether the goal is still driving the thread. */
export function isRunning(goal: Goal): boolean {
  return goal.status === "active";
}

export type ContinuationDecision =
  | { kind: "continue"; iteration: number }
  | { kind: "budget-exhausted" }
  | { kind: "inactive" };

/**
 * What to do when a thread with this goal goes idle. Budget exhaustion is a
 * distinct outcome because it changes the stored status, and the user needs to
 * see that the goal stopped for budget rather than for evidence.
 */
export function decideContinuation(goal: Goal | null): ContinuationDecision {
  if (goal === null || !isRunning(goal)) return { kind: "inactive" };
  if (goal.iterations >= goal.maxIterations) return { kind: "budget-exhausted" };
  return { kind: "continue", iteration: goal.iterations + 1 };
}

/**
 * The instruction block appended to every turn while a goal is active. Kept
 * well under the host's 4096-character cap by the objective limit above.
 */
export function goalInstructions(goal: Goal): string | null {
  if (!isRunning(goal)) return null;
  return [
    "# Active goal",
    "",
    goal.objective,
    "",
    `Iteration ${goal.iterations} of ${goal.maxIterations} used.`,
    "",
    "Keep working until that outcome is true. Do not stop at a plausible",
    "answer, and do not hand the work back while the goal is active.",
    "",
    "- Check the outcome against real evidence: tests, benchmarks, logs, files.",
    "- When the evidence shows the outcome is reached, call `goal_report` with",
    '  outcome "complete" and quote the evidence that proves it.',
    "- When you cannot proceed (missing access, a broken assumption, the same",
    '  failure twice), call `goal_report` with outcome "blocked" and say what',
    "  you need.",
    "- Never report completion you have not verified.",
  ].join("\n");
}

/** The message sent to the thread to start the next iteration. */
export function continuationPrompt(goal: Goal, iteration: number): string {
  return [
    `Goal continuation ${iteration} of ${goal.maxIterations}.`,
    "",
    goal.objective,
    "",
    "The thread went idle and this goal is still active. Review what the last",
    "iteration actually verified, then take the next step toward the outcome.",
    "Change approach when the last one failed rather than repeating it.",
    "",
    'Call `goal_report` with outcome "complete" once evidence proves the',
    'outcome, or with outcome "blocked" when you cannot proceed.',
  ].join("\n");
}

export class GoalInputError extends Error {}

/** Validates an objective typed by a user or an agent. */
export function normalizeObjective(raw: string): string {
  const objective = raw.trim();
  if (objective.length === 0) {
    throw new GoalInputError("An objective is required.");
  }
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    throw new GoalInputError(
      `The objective is ${objective.length} characters; the limit is ${MAX_OBJECTIVE_CHARS}. It is injected into every turn, so state the outcome, the verification, and the constraints, not the plan.`,
    );
  }
  return objective;
}

export function normalizeMaxIterations(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new GoalInputError(
      `--iterations must be a positive integer, got "${raw}".`,
    );
  }
  if (parsed > MAX_ITERATIONS_CEILING) {
    throw new GoalInputError(
      `--iterations must be at most ${MAX_ITERATIONS_CEILING}.`,
    );
  }
  return parsed;
}

export interface ParsedArgs {
  /** Positional arguments in order, with flags removed. */
  positional: string[];
  flags: Map<string, string | true>;
}

/**
 * Splits `--flag value`, `--flag=value`, and boolean `--flag` out of argv.
 * Values are not type-checked here; each command validates what it reads.
 */
export function parseArgs(
  argv: string[],
  valueFlags: readonly string[],
): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }
    const name = arg.slice(2);
    if (valueFlags.includes(name)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new GoalInputError(`--${name} needs a value.`);
      }
      flags.set(name, value);
      index += 1;
      continue;
    }
    flags.set(name, true);
  }
  return { positional, flags };
}

export function flagValue(parsed: ParsedArgs, name: string): string | null {
  const value = parsed.flags.get(name);
  if (value === undefined) return null;
  if (value === true) throw new GoalInputError(`--${name} needs a value.`);
  return value;
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: "active",
  paused: "paused",
  "budget-limited": "stopped at its iteration budget",
  complete: "complete",
  blocked: "blocked",
};

/** One-line summary used by `bb goal list` and the thread header. */
export function statusLine(goal: Goal): string {
  return `${STATUS_LABELS[goal.status]}, ${goal.iterations} of ${goal.maxIterations} iterations`;
}

/** Full `bb goal show` rendering. */
export function formatGoal(goal: Goal): string {
  const lines = [
    `Goal: ${STATUS_LABELS[goal.status]}`,
    `Thread: ${goal.threadId}`,
    `Iterations: ${goal.iterations} of ${goal.maxIterations}`,
    "",
    goal.objective,
  ];
  if (goal.outcome !== null) {
    lines.push("", goal.status === "complete" ? "Evidence:" : "Blocked on:", goal.outcome);
  }
  return lines.join("\n");
}
