export type GrantMode = "read" | "readwrite";
export type GrantTargetKind = "item" | "vault";
export type AuditAction = "read" | "write" | "deny" | "unlock" | "lock";

export interface Account {
  id: string;
  url: string;
  email: string;
}

export interface Grant {
  id: string;
  projectId: string;
  accountId: string;
  targetKind: GrantTargetKind;
  vaultId: string;
  vaultTitle: string;
  itemId: string | null;
  itemTitle: string | null;
  mode: GrantMode;
  createdAt: number;
  updatedAt: number;
}

export interface AuditRow {
  id: string;
  at: number;
  projectId: string | null;
  threadId: string | null;
  accountId: string;
  vaultId: string | null;
  vaultTitle: string | null;
  itemId: string | null;
  itemTitle: string | null;
  fieldId: string | null;
  fieldTitle: string | null;
  action: AuditAction;
  mode: GrantMode | null;
  detail: string | null;
}

export interface SecretRef {
  vault: string;
  item: string;
  section: string | null;
  field: string;
}

export interface ResolvedField {
  accountId: string;
  vaultId: string;
  vaultTitle: string;
  itemId: string;
  itemTitle: string;
  fieldId: string;
  fieldTitle: string;
  value: string;
}

export const CHANGE_CHANNEL = "onepassword-changed";
