import type { PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { flagValue } from "../argv.ts";
import { OnePasswordError } from "../errors.ts";
import type { OnePasswordService } from "../service.ts";

export async function unlockCommand(
  service: OnePasswordService,
  args: ParsedArgs,
): Promise<PluginCliResult> {
  const accountId = await resolveAccountId(service, args);
  await service.unlock(accountId);
  return { exitCode: 0, stdout: `Unlocked ${accountId}.\n` };
}

export async function lockCommand(
  service: OnePasswordService,
  args: ParsedArgs,
): Promise<PluginCliResult> {
  const accountId = await resolveAccountId(service, args);
  service.lock(accountId);
  return { exitCode: 0, stdout: `Locked ${accountId}.\n` };
}

export async function vaultsCommand(
  service: OnePasswordService,
  args: ParsedArgs,
): Promise<PluginCliResult> {
  const accountId = await resolveAccountId(service, args);
  const vaults = await service.listVaultsFor(accountId);
  if (args.flags.has("json")) {
    return { exitCode: 0, stdout: `${JSON.stringify({ accountId, vaults }, null, 2)}\n` };
  }
  if (vaults.length === 0) return { exitCode: 0, stdout: "No vaults.\n" };
  return {
    exitCode: 0,
    stdout: `${vaults.map((vault) => `${vault.itemCount}\t${vault.title}\t${vault.id}`).join("\n")}\n`,
  };
}

async function resolveAccountId(
  service: OnePasswordService,
  args: ParsedArgs,
): Promise<string> {
  const needle = flagValue(args, "account") ?? args.positional[0] ?? null;
  if (needle !== null) return service.resolveAccountId(needle);
  const { accounts, unlockedAccountIds } = await service.listAccounts();
  if (unlockedAccountIds.length === 1) {
    const id = unlockedAccountIds[0];
    if (id !== undefined) return id;
  }
  if (accounts.length === 1) {
    const id = accounts[0]?.id;
    if (id !== undefined) return id;
  }
  throw new OnePasswordError(
    "Pass --account <id|url|email>. This Mac has more than one 1Password account.",
  );
}
