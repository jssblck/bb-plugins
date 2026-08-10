// Durable goal state: one row per thread in the plugin's own SQLite database.
//
// Reads are synchronous because `bb.agents.contributeInstructions` runs on the
// thread-start path and must return the active goal without awaiting anything.
import type Database from "better-sqlite3";
import type { BbPluginApi } from "@bb/plugin-sdk";

import type { Goal, GoalStatus } from "./goal.ts";

interface GoalRow {
  thread_id: string;
  project_id: string;
  objective: string;
  status: string;
  iterations: number;
  max_iterations: number;
  outcome: string | null;
  created_at: number;
  updated_at: number;
}

const STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "budget-limited",
  "complete",
  "blocked",
];

function toGoal(row: GoalRow): Goal {
  const status = STATUSES.find((candidate) => candidate === row.status);
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    objective: row.objective,
    // A row written by a newer plugin version reads as paused rather than
    // driving a thread under a status this build does not understand.
    status: status ?? "paused",
    iterations: row.iterations,
    maxIterations: row.max_iterations,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GoalStore {
  private readonly db: Database.Database;

  constructor(bb: BbPluginApi) {
    this.db = bb.storage.database();
    bb.storage.migrate(this.db, [
      `CREATE TABLE IF NOT EXISTS goals (
        thread_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        iterations INTEGER NOT NULL DEFAULT 0,
        max_iterations INTEGER NOT NULL,
        outcome TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ]);
  }

  get(threadId: string): Goal | null {
    const row = this.db
      .prepare("SELECT * FROM goals WHERE thread_id = ?")
      .get(threadId) as GoalRow | undefined;
    return row === undefined ? null : toGoal(row);
  }

  list(): Goal[] {
    const rows = this.db
      .prepare("SELECT * FROM goals ORDER BY updated_at DESC")
      .all() as GoalRow[];
    return rows.map(toGoal);
  }

  /** Replaces any existing goal on the thread and restarts the budget. */
  set(args: {
    threadId: string;
    projectId: string;
    objective: string;
    maxIterations: number;
  }): Goal {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO goals
           (thread_id, project_id, objective, status, iterations, max_iterations, outcome, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 0, ?, NULL, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           project_id = excluded.project_id,
           objective = excluded.objective,
           status = 'active',
           iterations = 0,
           max_iterations = excluded.max_iterations,
           outcome = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        args.threadId,
        args.projectId,
        args.objective,
        args.maxIterations,
        now,
        now,
      );
    return this.require(args.threadId);
  }

  /**
   * Makes the goal active again. A goal that already spent its budget gets a
   * fresh one, because resuming it otherwise would stop on the next idle event.
   */
  resume(threadId: string, maxIterations?: number): Goal | null {
    const goal = this.get(threadId);
    if (goal === null) return null;
    const nextMax = maxIterations ?? goal.maxIterations;
    this.db
      .prepare(
        `UPDATE goals SET status = 'active', outcome = NULL, iterations = ?,
           max_iterations = ?, updated_at = ? WHERE thread_id = ?`,
      )
      .run(
        goal.iterations >= nextMax ? 0 : goal.iterations,
        nextMax,
        Date.now(),
        threadId,
      );
    return this.require(threadId);
  }

  setStatus(threadId: string, status: GoalStatus, outcome?: string): Goal | null {
    const changes = this.db
      .prepare(
        "UPDATE goals SET status = ?, outcome = ?, updated_at = ? WHERE thread_id = ?",
      )
      .run(status, outcome ?? null, Date.now(), threadId).changes;
    return changes === 0 ? null : this.require(threadId);
  }

  /**
   * Records that a continuation is being sent. Conditional on the goal still
   * being active at the stored iteration count so two idle events cannot spend
   * the same iteration twice.
   */
  claimIteration(threadId: string, iteration: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE goals SET iterations = ?, updated_at = ?
           WHERE thread_id = ? AND status = 'active' AND iterations = ?`,
        )
        .run(iteration, Date.now(), threadId, iteration - 1).changes > 0
    );
  }

  clear(threadId: string): boolean {
    return (
      this.db.prepare("DELETE FROM goals WHERE thread_id = ?").run(threadId)
        .changes > 0
    );
  }

  private require(threadId: string): Goal {
    const goal = this.get(threadId);
    if (goal === null) {
      throw new Error(`Goal for thread ${threadId} disappeared mid-write.`);
    }
    return goal;
  }
}
