import { OnePasswordError } from "./errors.ts";

export interface DotenvUpdate {
  content: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

const KEY_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=/;

export function upsertDotenv(
  content: string,
  assignments: Readonly<Record<string, string>>,
): DotenvUpdate {
  const names = Object.keys(assignments);
  assertNoDuplicateAssignments(content, names);

  const seen = new Set<string>();
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const lines = content.length === 0 ? [] : content.split("\n");
  const endsWithNewline = content.endsWith("\n");
  if (endsWithNewline && lines[lines.length - 1] === "") lines.pop();

  const next = lines.map((line) => {
    const match = KEY_LINE.exec(line);
    if (match === null) return line;
    const prefix = match[1] ?? "";
    const key = match[2];
    if (key === undefined || !Object.hasOwn(assignments, key)) return line;
    seen.add(key);
    const value = assignments[key] ?? "";
    const replacement = `${prefix}${formatAssignment(key, value)}`;
    if (replacement === line) unchanged.push(key);
    else updated.push(key);
    return replacement;
  });

  for (const name of names) {
    if (seen.has(name)) continue;
    added.push(name);
    next.push(formatAssignment(name, assignments[name] ?? ""));
  }

  let output = next.join("\n");
  if (output.length > 0) output += "\n";
  return { content: output, added, updated, unchanged };
}

export function assertNoDuplicateAssignments(
  content: string,
  names: readonly string[],
): void {
  const wanted = new Set(names);
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const match = KEY_LINE.exec(line);
    const key = match?.[2];
    if (key === undefined || !wanted.has(key)) continue;
    if (seen.has(key)) {
      throw new OnePasswordError(
        `Dotenv file has more than one assignment for ${key}.`,
      );
    }
    seen.add(key);
  }
}

export function formatAssignment(name: string, value: string): string {
  if (/^[A-Za-z0-9_./:@%+=-]*$/.test(value)) return `${name}=${value}`;
  return `${name}=${JSON.stringify(value)}`;
}
