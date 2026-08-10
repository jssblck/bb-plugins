// bb-plugin-goal — durable, provider-independent goals for bb threads.
//
// A goal is a thread's completion condition: what should be true, how it is
// verified, and what must not regress. While one is active bb re-states it in
// every turn and continues the thread each time it goes idle, until the agent
// reports a verified outcome or the iteration budget runs out.
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

import { createCliRegistration } from "./src/cli.ts";
import { goalInstructions } from "./src/goal.ts";
import { errorMessage, GoalService } from "./src/service.ts";

const goalSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  objective: z.string(),
  status: z.enum(["active", "paused", "budget-limited", "complete", "blocked"]),
  iterations: z.number().int(),
  maxIterations: z.number().int(),
  outcome: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const rpcContract = defineRpcContract({
  threadGoal: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ goal: goalSchema.nullable() }),
  },
  updateGoal: {
    input: z
      .object({
        threadId: z.string(),
        action: z.enum(["pause", "resume", "clear"]),
      })
      .strict(),
    output: z.object({ goal: goalSchema.nullable() }),
  },
});

export default function plugin(bb: BbPluginApi) {
  const service = new GoalService(bb);

  bb.cli.register(createCliRegistration(service));

  // Re-states the goal in every turn's instructions. Synchronous by contract:
  // the store reads SQLite directly rather than going through the SDK.
  bb.agents.contributeInstructions(({ threadId }) => {
    const goal = service.get(threadId);
    return goal === null ? null : goalInstructions(goal);
  });

  bb.agents.registerTool({
    name: "goal_report",
    description:
      "End the active goal on this thread. Report outcome 'complete' only when evidence you have actually seen (test output, benchmark numbers, logs, file contents) shows the objective is met, and quote that evidence. Report 'blocked' when you cannot proceed and say what you need. Does nothing when no goal is active.",
    experimental_statusLabels: {
      pending: "Reporting the goal outcome",
      completed: "Reported the goal outcome",
    },
    parameters: z.object({
      outcome: z.enum(["complete", "blocked"]),
      evidence: z
        .string()
        .min(1)
        .describe(
          "The evidence that proves the objective is met, or what is blocking the work.",
        ),
    }),
    execute: ({ outcome, evidence }, { threadId }) => {
      const status = outcome === "complete" ? "complete" : "blocked";
      const goal = service.setStatus(threadId, status, evidence);
      if (goal === null) {
        return {
          content: [
            { type: "text" as const, text: "No goal is set on this thread." },
          ],
          isError: true,
        };
      }
      return `Goal recorded as ${status} after ${goal.iterations} iterations. bb will not continue this thread for it again.`;
    },
  });

  bb.events.on("thread.idle", ({ thread }) => {
    void service.continueThread(thread.id).catch((error: unknown) => {
      bb.log.error(
        `goal continuation failed for ${thread.id}: ${errorMessage(error)}`,
      );
    });
  });

  // A failing thread would otherwise burn its whole budget on the same error.
  bb.events.on("thread.failed", ({ thread, error }) => {
    const goal = service.get(thread.id);
    if (goal === null || goal.status !== "active") return;
    service.setStatus(
      thread.id,
      "paused",
      `Paused after the thread failed: ${error ?? "unknown error"}`,
    );
  });

  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      service.clear(thread.id);
    });
  }

  bb.rpc.register(rpcContract, {
    threadGoal: ({ threadId }) => ({ goal: service.get(threadId) }),
    updateGoal: async ({ threadId, action }) => {
      switch (action) {
        case "pause":
          return {
            goal: service.setStatus(threadId, "paused", "Paused by the user."),
          };
        case "resume":
          return { goal: await service.resume(threadId) };
        case "clear":
          service.clear(threadId);
          return { goal: null };
      }
    },
  });

  bb.log.info(`watching ${service.list().length} goal(s)`);
}
