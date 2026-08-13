import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { flagValue } from "../argv.ts";
import { requireThreadId } from "../cli-context.ts";
import { optionalAccount } from "../cli-context.ts";
import { OnePasswordError } from "../errors.ts";
import { parseItemRef } from "../refs.ts";
import type { OnePasswordService } from "../service.ts";
import type { GrantMode } from "../types.ts";

export async function requestCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const rawRef = args.positional[0];
  if (rawRef === undefined) {
    throw new OnePasswordError(
      "request requires op://vault/item. Example: bb 1p request op://Personal/API --mode read",
    );
  }
  const mode = parseMode(flagValue(args, "mode"));
  const result = await service.requestAccess({
    threadId: requireThreadId(context),
    signal: context.signal,
    accountId: optionalAccount(args),
    ref: { ...parseItemRef(rawRef), section: null, field: "_" },
    mode,
    purpose: flagValue(args, "purpose"),
  });
  if (args.flags.has("json")) {
    return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
  }
  if (result.already) {
    return {
      exitCode: 0,
      stdout: `Already have ${result.mode} on ${result.vaultTitle} / ${result.itemTitle}.\n`,
    };
  }
  return {
    exitCode: 0,
    stdout: `Granted ${result.mode} on ${result.vaultTitle} / ${result.itemTitle}.\n`,
  };
}

function parseMode(raw: string | null): GrantMode {
  if (raw === null || raw === "read") return "read";
  if (raw === "readwrite" || raw === "write") return "readwrite";
  throw new OnePasswordError("--mode must be read or readwrite.");
}


