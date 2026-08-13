import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import type { ParsedArgs } from "../argv.ts";
import { resolveProjectId } from "../cli-context.ts";
import type { OnePasswordService } from "../service.ts";

export function grantedCommand(
  service: OnePasswordService,
  args: ParsedArgs,
  context: PluginCliContext,
): PluginCliResult {
  const projectId = resolveProjectId(args, context);
  const grants = service.store.listGrants(projectId);
  if (args.flags.has("json")) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ projectId, grants }, null, 2)}\n`,
    };
  }
  if (grants.length === 0) {
    return {
      exitCode: 0,
      stdout: `No 1Password grants for ${projectId}. Add them in the 1Password panel.\n`,
    };
  }
  const lines = grants.map((grant) => {
    const target =
      grant.targetKind === "vault"
        ? `vault ${grant.vaultTitle}`
        : `${grant.vaultTitle} / ${grant.itemTitle ?? grant.itemId}`;
    return `${grant.mode.padEnd(10)} ${target}`;
  });
  return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
}
