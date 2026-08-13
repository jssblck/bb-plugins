// bb-plugin-1password — project-granted 1Password access for bb agents.
//
// The panel unlocks the desktop app once per account. Agents then use `bb 1p`
// against grants stored in this plugin. They never call `op` in a new shell.
import type { BbPluginApi } from "@bb/plugin-sdk";

import { createCliRegistration } from "./src/cli.ts";
import { createRpcHandlers, rpcContract } from "./src/rpc.ts";
import { KEEP_ALIVE_MS, OnePasswordService } from "./src/service.ts";

export { rpcContract };

export default function plugin(bb: BbPluginApi) {
  const service = new OnePasswordService(bb);

  bb.rpc.register(rpcContract, createRpcHandlers(service));
  bb.cli.register(createCliRegistration(service));

  bb.agents.contributeInstructions(({ projectId }) => {
    const grants = service.store.listGrants(projectId);
    if (grants.length === 0) {
      return "This project has no 1Password grants yet. Request one with `bb 1p request op://vault/item --mode read`. Never call `op`.";
    }
    return `This project has ${grants.length} 1Password grant(s). Use \`bb 1p granted\` and \`bb 1p inject --write-env <path> NAME=op://vault/item/field\`. If an item is missing, run \`bb 1p request op://vault/item --mode read\`. Never call \`op\`.`;
  });

  bb.background.service("onepassword-keepalive", {
    async start(signal) {
      while (!signal.aborted) {
        await sleep(KEEP_ALIVE_MS, signal);
        if (signal.aborted) return;
        await service.keepAliveOnce().catch((error: unknown) => {
          bb.log.warn(`1Password keep-alive failed: ${String(error)}`);
        });
      }
    },
  });

  bb.onDispose(() => {
    service.session.lockAll();
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
