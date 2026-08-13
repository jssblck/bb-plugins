import { describe, expect, it } from "vitest";

import {
  denyMessage,
  modeAllows,
  requestNeeded,
  resolveGrantMode,
} from "./acl.ts";
import type { Grant } from "./types.ts";

function grant(overrides: Partial<Grant>): Grant {
  return {
    id: "g1",
    projectId: "proj_1",
    accountId: "acct_1",
    targetKind: "item",
    vaultId: "vault_1",
    vaultTitle: "Dev",
    itemId: "item_1",
    itemTitle: "API",
    mode: "read",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("resolveGrantMode", () => {
  it("returns the item grant when both item and vault grants exist", () => {
    const mode = resolveGrantMode(
      [
        grant({ targetKind: "vault", itemId: null, itemTitle: null, mode: "readwrite" }),
        grant({ mode: "read" }),
      ],
      {
        projectId: "proj_1",
        accountId: "acct_1",
        vaultId: "vault_1",
        itemId: "item_1",
      },
    );
    expect(mode).toBe("read");
  });

  it("falls back to the vault grant", () => {
    const mode = resolveGrantMode(
      [grant({ targetKind: "vault", itemId: null, mode: "readwrite" })],
      {
        projectId: "proj_1",
        accountId: "acct_1",
        vaultId: "vault_1",
        itemId: "item_2",
      },
    );
    expect(mode).toBe("readwrite");
  });

  it("ignores grants for another project or account", () => {
    expect(
      resolveGrantMode([grant({ projectId: "proj_other" })], {
        projectId: "proj_1",
        accountId: "acct_1",
        vaultId: "vault_1",
        itemId: "item_1",
      }),
    ).toBeNull();
    expect(
      resolveGrantMode([grant({ accountId: "acct_other" })], {
        projectId: "proj_1",
        accountId: "acct_1",
        vaultId: "vault_1",
        itemId: "item_1",
      }),
    ).toBeNull();
  });
});

describe("modeAllows", () => {
  it("lets readwrite satisfy read", () => {
    expect(modeAllows("readwrite", "read")).toBe(true);
    expect(modeAllows("read", "readwrite")).toBe(false);
    expect(modeAllows(null, "read")).toBe(false);
  });
});

describe("denyMessage", () => {
  it("names the item and points at bb 1p request", () => {
    expect(denyMessage({ itemTitle: "API", need: "read" })).toContain("API");
    expect(denyMessage({ itemTitle: "API", need: "readwrite" })).toContain(
      "bb 1p request",
    );
  });
});

describe("requestNeeded", () => {
  it("is false when the existing grant already covers the mode", () => {
    expect(requestNeeded("readwrite", "read")).toBe(false);
    expect(requestNeeded("read", "readwrite")).toBe(true);
    expect(requestNeeded(null, "read")).toBe(true);
  });
});
