import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { flagValue } from "../argv.ts";
import { optionalAccount, requireThreadId } from "../cli-context.ts";
import { OnePasswordError } from "../errors.ts";
import { parseSecretRef } from "../refs.ts";
import type { OnePasswordService } from "../service.ts";

export async function fieldGetCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const rawRef = args.positional[0];
  if (rawRef === undefined) {
    throw new OnePasswordError("field get requires op://vault/item/field.");
  }
  const writeEnv = flagValue(args, "write-env");
  const out = flagValue(args, "out");
  const name = flagValue(args, "name");
  if (writeEnv !== null && out !== null) {
    throw new OnePasswordError("Use either --write-env or --out, not both.");
  }
  if (writeEnv === null && out === null) {
    throw new OnePasswordError(
      "field get writes a file. Use --write-env <path> --name VAR or --out <path>. Do not print secrets.",
    );
  }
  if (writeEnv !== null && name === null) {
    throw new OnePasswordError("--write-env requires --name VAR.");
  }
  const dest =
    writeEnv !== null && name !== null
      ? ({ kind: "dotenv" as const, path: writeEnv, name })
      : { kind: "file" as const, path: out ?? "" };
  const result = await service.writeFieldToFile({
    threadId: requireThreadId(context),
    cwd: context.cwd,
    accountId: optionalAccount(args),
    ref: parseSecretRef(rawRef),
    dest,
  });
  return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
}
