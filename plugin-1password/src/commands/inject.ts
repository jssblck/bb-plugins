import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { flagValue } from "../argv.ts";
import { optionalAccount, requireThreadId } from "../cli-context.ts";
import { OnePasswordError } from "../errors.ts";
import { parseAssignment } from "../refs.ts";
import type { OnePasswordService } from "../service.ts";

export async function injectCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const writeEnv = flagValue(args, "write-env");
  if (writeEnv === null) {
    throw new OnePasswordError("inject requires --write-env <path>.");
  }
  if (args.positional.length === 0) {
    throw new OnePasswordError(
      "inject requires one or more NAME=op://vault/item/field assignments.",
    );
  }
  const result = await service.inject({
    threadId: requireThreadId(context),
    cwd: context.cwd,
    writeEnv,
    accountId: optionalAccount(args),
    assignments: args.positional.map(parseAssignment),
  });
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(result)}\n`,
  };
}
