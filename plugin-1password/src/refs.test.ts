import { describe, expect, it } from "vitest";

import {
  fieldMatches,
  isNotesField,
  parseAssignment,
  parseItemRef,
  parseSecretRef,
} from "./refs.ts";

describe("parseItemRef", () => {
  it("accepts item-only and field refs", () => {
    expect(parseItemRef("op://Dev/API")).toEqual({ vault: "Dev", item: "API" });
    expect(parseItemRef("op://Dev/API/password")).toEqual({
      vault: "Dev",
      item: "API",
    });
  });
});

describe("parseSecretRef", () => {
  it("parses three-part and four-part references", () => {
    expect(parseSecretRef("op://Dev/API/password")).toEqual({
      vault: "Dev",
      item: "API",
      section: null,
      field: "password",
    });
    expect(parseSecretRef("op://Dev/API/extra/token")).toEqual({
      vault: "Dev",
      item: "API",
      section: "extra",
      field: "token",
    });
  });

  it("rejects anything that is not a secret reference", () => {
    expect(() => parseSecretRef("Dev/API/password")).toThrow(/secret reference/);
  });
});

describe("parseAssignment", () => {
  it("splits NAME=ref", () => {
    expect(parseAssignment("API_KEY=op://Dev/API/password")).toEqual({
      name: "API_KEY",
      ref: {
        vault: "Dev",
        item: "API",
        section: null,
        field: "password",
      },
    });
  });
});

describe("fieldMatches", () => {
  it("matches field id, title, and optional section", () => {
    const field = { id: "password", title: "password", sectionId: "s1" };
    const sections = [{ id: "s1", title: "extra" }];
    expect(
      fieldMatches(field, sections, {
        vault: "v",
        item: "i",
        section: null,
        field: "password",
      }),
    ).toBe(true);
    expect(
      fieldMatches(field, sections, {
        vault: "v",
        item: "i",
        section: "extra",
        field: "password",
      }),
    ).toBe(true);
    expect(
      fieldMatches(field, sections, {
        vault: "v",
        item: "i",
        section: "other",
        field: "password",
      }),
    ).toBe(false);
  });
});

describe("isNotesField", () => {
  it("treats a bare notes field as item notes", () => {
    expect(
      isNotesField({ vault: "v", item: "i", section: null, field: "notes" }),
    ).toBe(true);
    expect(
      isNotesField({
        vault: "v",
        item: "i",
        section: "extra",
        field: "notes",
      }),
    ).toBe(false);
  });
});
