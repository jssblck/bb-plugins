import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { optionalAccount, requireThreadId } from "../cli-context.ts";
import type { OnePasswordService } from "../service.ts";

export async function selfTestCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const result = await service.runSelfTest({
    threadId: requireThreadId(context),
    cwd: context.cwd,
    accountId: optionalAccount(args),
  });
  return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
}
