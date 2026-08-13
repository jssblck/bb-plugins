import type { PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import type { OnePasswordService } from "../service.ts";

export async function statusCommand(
  service: OnePasswordService,
  args: ParsedArgs,
): Promise<PluginCliResult> {
  const status = await service.listAccounts();
  if (args.flags.has("json")) {
    return { exitCode: 0, stdout: `${JSON.stringify(status, null, 2)}\n` };
  }
  if (status.accounts.length === 0) {
    return { exitCode: 0, stdout: "No 1Password accounts on this Mac.\n" };
  }
  const lines = status.accounts.map((account) => {
    const state = status.unlockedAccountIds.includes(account.id)
      ? "unlocked"
      : "locked";
    return `${state.padEnd(9)} ${account.email}  ${account.url}  ${account.id}`;
  });
  return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
}
