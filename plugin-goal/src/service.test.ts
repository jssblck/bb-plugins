// Drives GoalService against a real SQLite database and a stub bb.sdk, so the
// continuation state machine is checked without a bb server or an LLM turn.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@bb/plugin-sdk";

import { GoalService } from "./service.ts";

interface FakeThread {
  id: string;
  projectId: string;
  providerId: string;
  status: string;
}

interface SentMessage {
  threadId: string;
  text: string;
}

function createHarness(thread: Partial<FakeThread> = {}) {
  const db = new Database(":memory:");
  const state = {
    thread: {
      id: "thr_1",
      projectId: "proj_1",
      providerId: "claude-code",
      status: "idle",
      ...thread,
    } as FakeThread,
    nativeGoal: null as { status: string } | null,
    sent: [] as SentMessage[],
    signals: [] as unknown[],
    sendFails: false,
  };

  const bb = {
    log: { debug() {}, info() {}, warn() {}, error() {} },
    realtime: {
      publish(_channel: string, payload: unknown) {
        state.signals.push(payload);
      },
    },
    storage: {
      database: () => db,
      migrate: (target: Database.Database, statements: string[]) => {
        for (const statement of statements) target.exec(statement);
      },
    },
    sdk: {
      threads: {
        get: async () => state.thread,
        timeline: async () => ({ goal: state.nativeGoal }),
        send: async (args: { threadId: string; input: { text: string }[] }) => {
          if (state.sendFails) throw new Error("thread is no longer idle");
          state.sent.push({
            threadId: args.threadId,
            text: args.input[0]!.text,
          });
          return { ok: true };
        },
      },
    },
  } as unknown as BbPluginApi;

  return { state, service: new GoalService(bb) };
}

describe("GoalService.set", () => {
  it("starts the work immediately on an idle thread", async () => {
    const { state, service } = createHarness();
    const goal = await service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 3,
    });
    expect(goal.iterations).toBe(1);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.text).toContain("Goal continuation 1 of 3.");
    expect(state.sent[0]!.text).toContain("Make the suite green");
  });

  it("waits for the thread to finish what it is doing", async () => {
    const { state, service } = createHarness({ status: "active" });
    const goal = await service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 3,
    });
    expect(goal.iterations).toBe(0);
    expect(state.sent).toHaveLength(0);
  });

  it("refuses a thread the provider is already driving with its own goal", async () => {
    const { state, service } = createHarness({ providerId: "codex" });
    state.nativeGoal = { status: "active" };
    await expect(
      service.set({
        threadId: "thr_1",
        objective: "Make the suite green",
        maxIterations: 3,
      }),
    ).rejects.toThrow(/already has a codex goal/);
    expect(service.get("thr_1")).toBeNull();
  });

  it("allows a codex thread whose native goal is finished", async () => {
    const { state, service } = createHarness({ providerId: "codex" });
    state.nativeGoal = { status: "complete" };
    const goal = await service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 3,
    });
    expect(goal.status).toBe("active");
  });
});

describe("GoalService.continueThread", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(async () => {
    harness = createHarness({ status: "active" });
    await harness.service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 2,
    });
    harness.state.thread.status = "idle";
  });

  it("spends one iteration per idle event and then stops at the budget", async () => {
    const { state, service } = harness;
    await service.continueThread("thr_1");
    expect(service.get("thr_1")!.iterations).toBe(1);

    await service.continueThread("thr_1");
    expect(service.get("thr_1")!.iterations).toBe(2);

    await service.continueThread("thr_1");
    const goal = service.get("thr_1")!;
    expect(goal.status).toBe("budget-limited");
    expect(goal.outcome).toContain("2 iterations");
    expect(state.sent).toHaveLength(2);
  });

  it("leaves a thread that is working alone", async () => {
    const { state, service } = harness;
    state.thread.status = "active";
    await service.continueThread("thr_1");
    expect(state.sent).toHaveLength(0);
    expect(service.get("thr_1")!.iterations).toBe(0);
  });

  it("does not continue a goal that already ended", async () => {
    const { state, service } = harness;
    service.setStatus("thr_1", "complete", "bench: p95 = 108 ms");
    await service.continueThread("thr_1");
    expect(state.sent).toHaveLength(0);
  });

  it("pauses when the provider takes over with its own goal", async () => {
    const { state, service } = harness;
    state.thread.providerId = "codex";
    state.nativeGoal = { status: "active" };
    await service.continueThread("thr_1");
    expect(service.get("thr_1")!.status).toBe("paused");
    expect(state.sent).toHaveLength(0);
  });

  it("keeps the goal active when the send is refused", async () => {
    const { state, service } = harness;
    state.sendFails = true;
    await service.continueThread("thr_1");
    expect(service.get("thr_1")!.status).toBe("active");
  });
});

describe("GoalService.resume", () => {
  it("grants a fresh budget to a goal that spent its own", async () => {
    const { state, service } = createHarness({ status: "active" });
    await service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 1,
    });
    state.thread.status = "idle";
    await service.continueThread("thr_1");
    await service.continueThread("thr_1");
    expect(service.get("thr_1")!.status).toBe("budget-limited");

    const resumed = await service.resume("thr_1");
    expect(resumed!.status).toBe("active");
    // The fresh budget was granted, then immediately spent on one continuation.
    expect(resumed!.iterations).toBe(1);
    expect(resumed!.maxIterations).toBe(1);
  });

  it("takes a bigger budget without touching the objective", async () => {
    const { state, service } = createHarness({ status: "active" });
    await service.set({
      threadId: "thr_1",
      objective: "Make the suite green",
      maxIterations: 2,
    });
    state.thread.status = "active";
    service.setStatus("thr_1", "paused");
    const resumed = await service.resume("thr_1", 20);
    expect(resumed!.maxIterations).toBe(20);
    expect(resumed!.objective).toBe("Make the suite green");
  });

  it("reports nothing to resume on a thread without a goal", async () => {
    const { service } = createHarness();
    expect(await service.resume("thr_1")).toBeNull();
  });
});
