export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(
  argv: string[],
  valueFlags: readonly string[] = [],
): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valueSet = new Set(valueFlags);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) break;
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (valueSet.has(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} needs a value.`);
      }
      flags.set(name, value);
      i += 1;
      continue;
    }
    flags.set(name, true);
  }
  return { positional, flags };
}

export function flagValue(args: ParsedArgs, name: string): string | null {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : null;
}
