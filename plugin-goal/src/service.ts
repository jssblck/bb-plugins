// Everything that touches a live thread: setting a goal, ending one, and
// continuing an idle thread that still has one.
import type { BbPluginApi } from "@bb/plugin-sdk";

import {
  continuationPrompt,
  decideContinuation,
  GOAL_CHANGED_CHANNEL,
  GoalInputError,
  type Goal,
  type GoalStatus,
} from "./goal.ts";
import { GoalStore } from "./store.ts";

/** The one provider with its own goal loop (`/goal` in the composer). */
const NATIVE_GOAL_PROVIDER = "codex";

export class GoalService {
  readonly store: GoalStore;

  constructor(private readonly bb: BbPluginApi) {
    this.store = new GoalStore(bb);
  }

  get(threadId: string): Goal | null {
    return this.store.get(threadId);
  }

  list(): Goal[] {
    return this.store.list();
  }

  async set(args: {
    threadId: string;
    objective: string;
    maxIterations: number;
  }): Promise<Goal> {
    const thread = await this.bb.sdk.threads.get({ threadId: args.threadId });
    if (
      thread.providerId === NATIVE_GOAL_PROVIDER &&
      (await this.nativeGoalActive(thread.id))
    ) {
      throw new GoalInputError(
        `This thread already has a ${thread.providerId} goal, and two goal loops steering one thread fight each other. Manage it with the provider's own /goal command, or clear it with \`bb thread clear-goal ${thread.id}\` first.`,
      );
    }
    const goal = this.store.set({
      threadId: thread.id,
      projectId: thread.projectId,
      objective: args.objective,
      maxIterations: args.maxIterations,
    });
    this.publish(goal.threadId);
    this.bb.log.info(
      `goal set on ${goal.threadId} (budget ${goal.maxIterations})`,
    );
    // Start the work now when the thread is already idle, rather than waiting
    // for the next idle event that may never come.
    await this.continueThread(goal.threadId);
    return this.store.get(goal.threadId) ?? goal;
  }

  setStatus(
    threadId: string,
    status: GoalStatus,
    outcome?: string,
  ): Goal | null {
    const goal = this.store.setStatus(threadId, status, outcome);
    if (goal !== null) this.publish(threadId);
    return goal;
  }

  /**
   * Makes the goal active again and continues the thread when it is already
   * idle, so resuming does not wait for the user to send a message.
   */
  async resume(threadId: string, maxIterations?: number): Promise<Goal | null> {
    const goal = this.store.resume(threadId, maxIterations);
    if (goal === null) return null;
    this.publish(threadId);
    await this.continueThread(threadId);
    return this.store.get(threadId);
  }

  clear(threadId: string): boolean {
    const cleared = this.store.clear(threadId);
    if (cleared) this.publish(threadId);
    return cleared;
  }

  /**
   * Sends the next iteration when an idle thread still has an active goal.
   * Runs on every `thread.idle` event and on resume, so it re-reads the
   * thread: a goal never steals a turn from a thread that is already working.
   */
  async continueThread(threadId: string): Promise<void> {
    const goal = this.store.get(threadId);
    const decision = decideContinuation(goal);
    if (goal === null || decision.kind === "inactive") return;

    if (decision.kind === "budget-exhausted") {
      this.setStatus(
        threadId,
        "budget-limited",
        `Stopped after ${goal.maxIterations} iterations without a reported outcome.`,
      );
      this.bb.log.info(`goal on ${threadId} hit its iteration budget`);
      return;
    }

    const thread = await this.bb.sdk.threads.get({ threadId });
    if (thread.status !== "idle") return;
    if (
      thread.providerId === NATIVE_GOAL_PROVIDER &&
      (await this.nativeGoalActive(threadId))
    ) {
      this.setStatus(
        threadId,
        "paused",
        "Paused because the provider started its own goal on this thread.",
      );
      return;
    }

    if (!this.store.claimIteration(threadId, decision.iteration)) return;
    this.publish(threadId);

    try {
      await this.bb.sdk.threads.send({
        threadId,
        mode: "start",
        input: [
          {
            type: "text",
            text: continuationPrompt(goal, decision.iteration),
            visibility: "agent-only",
            mentions: [],
          },
        ],
      });
    } catch (error) {
      // The thread stopped being idle between the status read and the send.
      // Leave the goal active; the next idle event continues it.
      this.bb.log.warn(
        `goal continuation for ${threadId} was not delivered: ${errorMessage(error)}`,
      );
    }
  }

  private publish(threadId: string): void {
    this.bb.realtime.publish(GOAL_CHANGED_CHANNEL, { threadId });
  }

  /** True when the provider is running its own goal on this thread. */
  private async nativeGoalActive(threadId: string): Promise<boolean> {
    try {
      const timeline = await this.bb.sdk.threads.timeline({
        threadId,
        summaryOnly: "true",
      });
      const native = timeline.goal;
      return native !== null && native.status !== "complete";
    } catch (error) {
      this.bb.log.warn(
        `could not read provider goal state for ${threadId}: ${errorMessage(error)}`,
      );
      return false;
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
