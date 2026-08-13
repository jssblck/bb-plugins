import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { BbPluginApi } from "@bb/plugin-sdk";

import type {
  AuditAction,
  AuditRow,
  Grant,
  GrantMode,
  GrantTargetKind,
} from "./types.ts";

interface GrantRow {
  id: string;
  project_id: string;
  account_id: string;
  target_kind: string;
  vault_id: string;
  vault_title: string;
  item_id: string;
  item_title: string;
  mode: string;
  created_at: number;
  updated_at: number;
}

interface AuditDbRow {
  id: string;
  at: number;
  project_id: string | null;
  thread_id: string | null;
  account_id: string;
  vault_id: string | null;
  vault_title: string | null;
  item_id: string | null;
  item_title: string | null;
  field_id: string | null;
  field_title: string | null;
  action: string;
  mode: string | null;
  detail: string | null;
}

const MODES: readonly GrantMode[] = ["read", "readwrite"];
const KINDS: readonly GrantTargetKind[] = ["item", "vault"];
const ACTIONS: readonly AuditAction[] = [
  "read",
  "write",
  "deny",
  "unlock",
  "lock",
];

export class GrantStore {
  private readonly db: Database.Database;

  constructor(bb: BbPluginApi) {
    this.db = bb.storage.database();
    bb.storage.migrate(this.db, [
      `CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        vault_id TEXT NOT NULL,
        vault_title TEXT NOT NULL,
        item_id TEXT NOT NULL DEFAULT '',
        item_title TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (project_id, account_id, target_kind, vault_id, item_id)
      )`,
      `CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        project_id TEXT,
        thread_id TEXT,
        account_id TEXT NOT NULL,
        vault_id TEXT,
        vault_title TEXT,
        item_id TEXT,
        item_title TEXT,
        field_id TEXT,
        field_title TEXT,
        action TEXT NOT NULL,
        mode TEXT,
        detail TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS audit_at ON audit (at DESC)`,
    ]);
  }

  listGrants(projectId?: string): Grant[] {
    const rows =
      projectId === undefined
        ? (this.db
            .prepare("SELECT * FROM grants ORDER BY vault_title, item_title")
            .all() as GrantRow[])
        : (this.db
            .prepare(
              "SELECT * FROM grants WHERE project_id = ? ORDER BY vault_title, item_title",
            )
            .all(projectId) as GrantRow[]);
    return rows.map(toGrant);
  }

  setGrant(args: {
    projectId: string;
    accountId: string;
    targetKind: GrantTargetKind;
    vaultId: string;
    vaultTitle: string;
    itemId: string | null;
    itemTitle: string | null;
    mode: GrantMode | null;
  }): Grant | null {
    const itemId = args.targetKind === "vault" ? "" : (args.itemId ?? "");
    if (args.targetKind === "item" && itemId === "") {
      throw new Error("Item grants need an item id.");
    }
    if (args.mode === null) {
      this.db
        .prepare(
          `DELETE FROM grants
           WHERE project_id = ? AND account_id = ? AND target_kind = ?
             AND vault_id = ? AND item_id = ?`,
        )
        .run(
          args.projectId,
          args.accountId,
          args.targetKind,
          args.vaultId,
          itemId,
        );
      return null;
    }
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO grants (
           id, project_id, account_id, target_kind, vault_id, vault_title,
           item_id, item_title, mode, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, account_id, target_kind, vault_id, item_id)
         DO UPDATE SET
           vault_title = excluded.vault_title,
           item_title = excluded.item_title,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        args.projectId,
        args.accountId,
        args.targetKind,
        args.vaultId,
        args.vaultTitle,
        itemId,
        args.itemTitle ?? "",
        args.mode,
        now,
        now,
      );
    const row = this.db
      .prepare(
        `SELECT * FROM grants
         WHERE project_id = ? AND account_id = ? AND target_kind = ?
           AND vault_id = ? AND item_id = ?`,
      )
      .get(
        args.projectId,
        args.accountId,
        args.targetKind,
        args.vaultId,
        itemId,
      ) as GrantRow;
    return toGrant(row);
  }

  writeAudit(row: Omit<AuditRow, "id" | "at"> & { at?: number }): void {
    this.db
      .prepare(
        `INSERT INTO audit (
           id, at, project_id, thread_id, account_id, vault_id, vault_title,
           item_id, item_title, field_id, field_title, action, mode, detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        row.at ?? Date.now(),
        row.projectId,
        row.threadId,
        row.accountId,
        row.vaultId,
        row.vaultTitle,
        row.itemId,
        row.itemTitle,
        row.fieldId,
        row.fieldTitle,
        row.action,
        row.mode,
        row.detail,
      );
  }

  listAudit(limit = 50): AuditRow[] {
    const rows = this.db
      .prepare("SELECT * FROM audit ORDER BY at DESC LIMIT ?")
      .all(limit) as AuditDbRow[];
    return rows.map(toAudit);
  }
}

function toGrant(row: GrantRow): Grant {
  const mode = MODES.find((candidate) => candidate === row.mode) ?? "read";
  const targetKind =
    KINDS.find((candidate) => candidate === row.target_kind) ?? "item";
  return {
    id: row.id,
    projectId: row.project_id,
    accountId: row.account_id,
    targetKind,
    vaultId: row.vault_id,
    vaultTitle: row.vault_title,
    itemId: row.item_id === "" ? null : row.item_id,
    itemTitle: row.item_title === "" ? null : row.item_title,
    mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAudit(row: AuditDbRow): AuditRow {
  const action = ACTIONS.find((candidate) => candidate === row.action) ?? "deny";
  const mode = MODES.find((candidate) => candidate === row.mode) ?? null;
  return {
    id: row.id,
    at: row.at,
    projectId: row.project_id,
    threadId: row.thread_id,
    accountId: row.account_id,
    vaultId: row.vault_id,
    vaultTitle: row.vault_title,
    itemId: row.item_id,
    itemTitle: row.item_title,
    fieldId: row.field_id,
    fieldTitle: row.field_title,
    action,
    mode,
    detail: row.detail,
  };
}
