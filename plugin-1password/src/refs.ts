import { OnePasswordError } from "./errors.ts";
import type { SecretRef } from "./types.ts";

const REF_PATTERN =
  /^op:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/;

export function parseItemRef(raw: string): { vault: string; item: string } {
  const trimmed = raw.trim();
  const match = /^op:\/\/([^/]+)\/([^/]+)(?:\/.*)?$/.exec(trimmed);
  const vault = match?.[1];
  const item = match?.[2];
  if (vault === undefined || item === undefined) {
    throw new OnePasswordError(
      `Not an item reference: ${trimmed}. Use op://vault/item.`,
    );
  }
  return { vault, item };
}

export function parseSecretRef(raw: string): SecretRef {
  const trimmed = raw.trim();
  const match = REF_PATTERN.exec(trimmed);
  if (match === null) {
    throw new OnePasswordError(
      `Not a secret reference: ${trimmed}. Use op://vault/item/field.`,
    );
  }
  const vault = match[1];
  const item = match[2];
  const third = match[3];
  const fourth = match[4];
  if (vault === undefined || item === undefined || third === undefined) {
    throw new OnePasswordError(
      `Not a secret reference: ${trimmed}. Use op://vault/item/field.`,
    );
  }
  if (fourth !== undefined) {
    return { vault, item, section: third, field: fourth };
  }
  return { vault, item, section: null, field: third };
}

export function parseAssignment(raw: string): { name: string; ref: SecretRef } {
  const eq = raw.indexOf("=");
  if (eq <= 0) {
    throw new OnePasswordError(
      `Expected NAME=op://vault/item/field, got ${raw}.`,
    );
  }
  const name = raw.slice(0, eq);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new OnePasswordError(`Invalid environment variable name: ${name}.`);
  }
  return { name, ref: parseSecretRef(raw.slice(eq + 1)) };
}

export function fieldMatches(
  field: { id: string; title: string; sectionId?: string },
  sections: ReadonlyArray<{ id: string; title: string }>,
  ref: SecretRef,
): boolean {
  const nameMatches =
    field.id === ref.field ||
    field.title.toLowerCase() === ref.field.toLowerCase();
  if (!nameMatches) return false;
  if (ref.section === null) return true;
  if (field.sectionId === ref.section) return true;
  const section = sections.find((entry) => entry.id === field.sectionId);
  return section?.title.toLowerCase() === ref.section.toLowerCase();
}

export function isNotesField(ref: SecretRef): boolean {
  return ref.section === null && ref.field.toLowerCase() === "notes";
}
