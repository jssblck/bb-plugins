import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { optionalAccount, requireThreadId } from "../cli-context.ts";
import { OnePasswordError } from "../errors.ts";
import { parseSecretRef } from "../refs.ts";
import type { OnePasswordService } from "../service.ts";

export async function fieldPrintCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const rawRef = args.positional[0];
  if (rawRef === undefined) {
    throw new OnePasswordError("field print requires op://vault/item/field.");
  }
  const value = await service.printField({
    threadId: requireThreadId(context),
    accountId: optionalAccount(args),
    ref: parseSecretRef(rawRef),
  });
  return { exitCode: 0, stdout: value.endsWith("\n") ? value : `${value}\n` };
}
