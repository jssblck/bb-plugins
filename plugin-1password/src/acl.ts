import type { Grant, GrantMode } from "./types.ts";

export function resolveGrantMode(
  grants: readonly Grant[],
  args: {
    projectId: string;
    accountId: string;
    vaultId: string;
    itemId: string;
  },
): GrantMode | null {
  const matching = grants.filter(
    (grant) =>
      grant.projectId === args.projectId && grant.accountId === args.accountId,
  );
  const itemGrant = matching.find(
    (grant) =>
      grant.targetKind === "item" &&
      grant.vaultId === args.vaultId &&
      grant.itemId === args.itemId,
  );
  if (itemGrant !== undefined) return itemGrant.mode;
  const vaultGrant = matching.find(
    (grant) => grant.targetKind === "vault" && grant.vaultId === args.vaultId,
  );
  return vaultGrant?.mode ?? null;
}

export function modeAllows(have: GrantMode | null, need: GrantMode): boolean {
  if (have === null) return false;
  if (need === "read") return true;
  return have === "readwrite";
}

export function denyMessage(args: {
  itemTitle: string;
  need: GrantMode;
}): string {
  const modeFlag = args.need === "readwrite" ? "readwrite" : "read";
  return `No ${modeFlag} grant for "${args.itemTitle}" in this project. Request it with \`bb 1p request op://vault/item --mode ${modeFlag}\`.`;
}

export function requestNeeded(
  have: GrantMode | null,
  need: GrantMode,
): boolean {
  return !modeAllows(have, need);
}
