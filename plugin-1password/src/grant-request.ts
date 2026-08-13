export const GRANT_REQUEST_RENDERER = "grant-request";

export interface GrantRequestPayload {
  purpose: string | null;
  mode: "read" | "readwrite";
  vaultTitle: string;
  itemTitle: string;
  accountLabel: string;
}

export interface GrantRequestResponse {
  approved: boolean;
}

export function parseGrantRequestPayload(
  raw: unknown,
): GrantRequestPayload | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.mode !== "read" && value.mode !== "readwrite") return null;
  if (typeof value.vaultTitle !== "string") return null;
  if (typeof value.itemTitle !== "string") return null;
  if (typeof value.accountLabel !== "string") return null;
  if (value.purpose !== null && typeof value.purpose !== "string") return null;
  return {
    purpose: value.purpose,
    mode: value.mode,
    vaultTitle: value.vaultTitle,
    itemTitle: value.itemTitle,
    accountLabel: value.accountLabel,
  };
}

export function parseGrantRequestResponse(
  raw: unknown,
): GrantRequestResponse | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.approved !== "boolean") return null;
  return { approved: value.approved };
}
