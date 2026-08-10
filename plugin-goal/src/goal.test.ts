import { describe, expect, it } from "vitest";

import {
  continuationPrompt,
  decideContinuation,
  flagValue,
  formatGoal,
  GoalInputError,
  goalInstructions,
  MAX_OBJECTIVE_CHARS,
  normalizeMaxIterations,
  normalizeObjective,
  parseArgs,
  type Goal,
} from "./goal.ts";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    threadId: "thr_1",
    projectId: "proj_1",
    objective: "Cut p95 checkout latency below 120 ms, verified by the bench.",
    status: "active",
    iterations: 0,
    maxIterations: 10,
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("decideContinuation", () => {
  it("continues an active goal with budget left", () => {
    expect(decideContinuation(makeGoal({ iterations: 3 }))).toEqual({
      kind: "continue",
      iteration: 4,
    });
  });

  it("stops at the iteration budget", () => {
    expect(
      decideContinuation(makeGoal({ iterations: 10, maxIterations: 10 })),
    ).toEqual({ kind: "budget-exhausted" });
  });

  it("ignores goals that are not active", () => {
    for (const status of ["paused", "complete", "blocked", "budget-limited"] as const) {
      expect(decideContinuation(makeGoal({ status }))).toEqual({
        kind: "inactive",
      });
    }
    expect(decideContinuation(null)).toEqual({ kind: "inactive" });
  });
});

describe("goalInstructions", () => {
  it("states the objective and the remaining budget", () => {
    const text = goalInstructions(makeGoal({ iterations: 2 }))!;
    expect(text).toContain("Cut p95 checkout latency");
    expect(text).toContain("Iteration 2 of 10 used.");
    expect(text).toContain("goal_report");
    expect(text.length).toBeLessThan(4096);
  });

  it("contributes nothing once the goal stops driving the thread", () => {
    expect(goalInstructions(makeGoal({ status: "paused" }))).toBeNull();
    expect(goalInstructions(makeGoal({ status: "complete" }))).toBeNull();
  });

  it("stays under the host instruction cap with the longest objective", () => {
    const goal = makeGoal({ objective: "x".repeat(MAX_OBJECTIVE_CHARS) });
    expect(goalInstructions(goal)!.length).toBeLessThan(4096);
  });
});

describe("continuationPrompt", () => {
  it("numbers the iteration and repeats the objective", () => {
    const text = continuationPrompt(makeGoal(), 4);
    expect(text).toContain("Goal continuation 4 of 10.");
    expect(text).toContain("Cut p95 checkout latency");
  });
});

describe("normalizeObjective", () => {
  it("trims the objective", () => {
    expect(normalizeObjective("  ship it  ")).toBe("ship it");
  });

  it("rejects an empty objective", () => {
    expect(() => normalizeObjective("   ")).toThrow(GoalInputError);
  });

  it("rejects an objective too long to inject every turn", () => {
    expect(() => normalizeObjective("x".repeat(MAX_OBJECTIVE_CHARS + 1))).toThrow(
      GoalInputError,
    );
  });
});

describe("normalizeMaxIterations", () => {
  it("accepts a positive integer", () => {
    expect(normalizeMaxIterations("25")).toBe(25);
  });

  it("rejects zero, fractions, junk, and absurd budgets", () => {
    for (const value of ["0", "-1", "2.5", "many", "1000"]) {
      expect(() => normalizeMaxIterations(value)).toThrow(GoalInputError);
    }
  });
});

describe("parseArgs", () => {
  it("splits value flags, boolean flags, and positionals", () => {
    const parsed = parseArgs(
      ["reduce", "latency", "--iterations", "5", "--json", "--thread=thr_9"],
      ["thread", "iterations"],
    );
    expect(parsed.positional).toEqual(["reduce", "latency"]);
    expect(flagValue(parsed, "iterations")).toBe("5");
    expect(flagValue(parsed, "thread")).toBe("thr_9");
    expect(parsed.flags.get("json")).toBe(true);
  });

  it("keeps a flag-like objective word out of the flag map", () => {
    const parsed = parseArgs(["--thread", "thr_1", "make", "it", "fast"], [
      "thread",
    ]);
    expect(parsed.positional).toEqual(["make", "it", "fast"]);
  });

  it("rejects a value flag with nothing after it", () => {
    expect(() => parseArgs(["--thread"], ["thread"])).toThrow(GoalInputError);
  });

  it("rejects a boolean flag used where a value is required", () => {
    const parsed = parseArgs(["--thread"], []);
    expect(() => flagValue(parsed, "thread")).toThrow(GoalInputError);
  });
});

describe("formatGoal", () => {
  it("labels evidence on a complete goal", () => {
    const text = formatGoal(
      makeGoal({ status: "complete", outcome: "bench: p95 = 108 ms" }),
    );
    expect(text).toContain("Goal: complete");
    expect(text).toContain("Evidence:");
    expect(text).toContain("p95 = 108 ms");
  });

  it("labels the reason a blocked goal stopped", () => {
    const text = formatGoal(
      makeGoal({ status: "blocked", outcome: "No access to the benchmark host" }),
    );
    expect(text).toContain("Blocked on:");
  });
});
