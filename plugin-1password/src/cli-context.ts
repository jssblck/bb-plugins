import type { PluginCliContext } from "@bb/plugin-sdk";

import type { ParsedArgs } from "./argv.ts";
import { flagValue } from "./argv.ts";
import { OnePasswordError } from "./errors.ts";

export function requireThreadId(context: PluginCliContext): string {
  if (context.threadId === undefined) {
    throw new OnePasswordError(
      "This command must run from a bb thread so it can write to the thread host.",
    );
  }
  return context.threadId;
}

export function optionalAccount(args: ParsedArgs): string | null {
  return flagValue(args, "account");
}

export function resolveProjectId(
  args: ParsedArgs,
  context: PluginCliContext,
): string {
  const explicit = flagValue(args, "project");
  if (explicit !== null) return explicit;
  if (context.projectId !== undefined) return context.projectId;
  throw new OnePasswordError(
    "Name a project with --project <id>, or run this from a project thread.",
  );
}
