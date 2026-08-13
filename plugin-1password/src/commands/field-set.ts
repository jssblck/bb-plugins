import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { flagValue } from "../argv.ts";
import { optionalAccount, requireThreadId } from "../cli-context.ts";
import { OnePasswordError } from "../errors.ts";
import { parseSecretRef } from "../refs.ts";
import type { OnePasswordService } from "../service.ts";

export async function fieldSetCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const rawRef = args.positional[0];
  if (rawRef === undefined) {
    throw new OnePasswordError("field set requires op://vault/item/field.");
  }
  const fromFile = flagValue(args, "from-file");
  if (fromFile === null) {
    throw new OnePasswordError(
      "field set requires --from-file <path>. Do not put secret values on the command line.",
    );
  }
  const threadId = requireThreadId(context);
  const value = await service.readHostText({
    threadId,
    cwd: context.cwd,
    path: fromFile,
  });
  const result = await service.writeGrantedField({
    threadId,
    accountId: optionalAccount(args),
    ref: parseSecretRef(rawRef),
    value: value.endsWith("\n") ? value.slice(0, -1) : value,
  });
  return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
}
