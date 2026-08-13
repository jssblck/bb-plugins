import { describe, expect, it } from "vitest";

import {
  parseGrantRequestPayload,
  parseGrantRequestResponse,
} from "./grant-request.ts";

describe("parseGrantRequestPayload", () => {
  it("accepts a complete payload", () => {
    expect(
      parseGrantRequestPayload({
        purpose: "Need the token",
        mode: "readwrite",
        vaultTitle: "Personal",
        itemTitle: "API",
        accountLabel: "ada@example.com",
      }),
    ).toEqual({
      purpose: "Need the token",
      mode: "readwrite",
      vaultTitle: "Personal",
      itemTitle: "API",
      accountLabel: "ada@example.com",
    });
  });

  it("rejects a bad mode", () => {
    expect(
      parseGrantRequestPayload({
        purpose: null,
        mode: "admin",
        vaultTitle: "Personal",
        itemTitle: "API",
        accountLabel: "x",
      }),
    ).toBeNull();
  });
});

describe("parseGrantRequestResponse", () => {
  it("requires approved", () => {
    expect(parseGrantRequestResponse({ approved: true })).toEqual({
      approved: true,
    });
    expect(parseGrantRequestResponse({})).toBeNull();
  });
});
