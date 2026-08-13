import { describe, expect, it } from "vitest";

import { formatAssignment, upsertDotenv } from "./dotenv.ts";

describe("upsertDotenv", () => {
  it("adds missing keys and updates existing ones", () => {
    const result = upsertDotenv("KEEP=yes\nAPI_KEY=old\n", {
      API_KEY: "new",
      OTHER: "x",
    });
    expect(result.updated).toEqual(["API_KEY"]);
    expect(result.added).toEqual(["OTHER"]);
    expect(result.content).toBe("KEEP=yes\nAPI_KEY=new\nOTHER=x\n");
  });

  it("preserves export prefixes", () => {
    const result = upsertDotenv("export TOKEN=old\n", { TOKEN: "next" });
    expect(result.content).toBe("export TOKEN=next\n");
  });

  it("refuses duplicate keys in the existing file", () => {
    expect(() =>
      upsertDotenv("A=1\nA=2\n", { A: "3" }),
    ).toThrow(/more than one assignment/i);
  });
});

describe("formatAssignment", () => {
  it("quotes values that need it", () => {
    expect(formatAssignment("A", "plain")).toBe("A=plain");
    expect(formatAssignment("A", "has space")).toBe('A="has space"');
  });
});
