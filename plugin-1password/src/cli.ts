import type {
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
} from "@bb/plugin-sdk";

import { parseArgs } from "./argv.ts";
import { fieldGetCommand } from "./commands/field-get.ts";
import { fieldPrintCommand } from "./commands/field-print.ts";
import { fieldSetCommand } from "./commands/field-set.ts";
import { grantedCommand } from "./commands/granted.ts";
import { injectCommand } from "./commands/inject.ts";
import { requestCommand } from "./commands/request.ts";
import { statusCommand } from "./commands/status.ts";
import { selfTestCommand } from "./commands/self-test.ts";
import {
  lockCommand,
  unlockCommand,
  vaultsCommand,
} from "./commands/unlock.ts";
import { errorMessage } from "./errors.ts";
import type { OnePasswordService } from "./service.ts";

const VALUE_FLAGS = [
  "write-env",
  "out",
  "name",
  "from-file",
  "account",
  "project",
  "mode",
  "purpose",
] as const;

const HELP = `bb 1p - read and write granted 1Password items without calling op.

  status [--json]
  unlock --account <id|url|email>
  lock --account <id|url|email>
  vaults [--account <id>] [--json]
  granted [--project <id>] [--json]
  request op://vault/item [--mode read|readwrite] [--purpose <text>]
  inject --write-env <path> NAME=op://vault/item/field...
  field get <ref> --write-env <path> --name VAR
  field get <ref> --out <path>
  field set <ref> --from-file <path>
  field print <ref>

  --account <id>   Required when more than one account is unlocked

If an item is not granted, request it. Unlock happens automatically when
the desktop session is locked. Prefer inject and field get.
field print puts the secret in the transcript. Never call op.`;

export function createCliRegistration(
  service: OnePasswordService,
): PluginCliRegistration {
  return {
    name: "1p",
    summary: "Read and write 1Password items this project has been granted",
    commands: [
      {
        name: "status",
        summary: "Show 1Password accounts and whether they are unlocked",
        usage: "bb 1p status [--json]",
      },
      {
        name: "unlock",
        summary: "Unlock a 1Password account (approve the prompt on this Mac)",
        usage: "bb 1p unlock --account <id|url|email>",
      },
      {
        name: "lock",
        summary: "Drop the unlocked desktop session for an account",
        usage: "bb 1p lock --account <id|url|email>",
      },
      {
        name: "vaults",
        summary: "List vault titles in an unlocked account",
        usage: "bb 1p vaults [--account <id>] [--json]",
      },
      {
        name: "granted",
        summary: "List 1Password grants for this project",
        usage: "bb 1p granted [--project <id>] [--json]",
      },
      {
        name: "request",
        summary: "Ask the user to grant this project access to one item",
        usage:
          "bb 1p request op://vault/item [--mode read|readwrite] [--purpose <text>] [--account <id>]",
      },
      {
        name: "inject",
        summary: "Write granted fields into a dotenv file on the thread host",
        usage:
          "bb 1p inject --write-env <path> NAME=op://vault/item/field...",
      },
      {
        name: "self-test",
        summary: "Create a throwaway item, grant it, inject it, then delete it",
        usage: "bb 1p self-test [--account <id>]",
      },
      {
        name: "field",
        summary: "Read or write one granted field",
        usage:
          "bb 1p field get|set|print <ref> [--write-env <path> --name VAR | --out <path> | --from-file <path>]",
      },
    ],
    run: async (argv, context) => {
      try {
        return await runCommand(service, argv, context);
      } catch (error) {
        return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
      }
    },
  };
}

async function runCommand(
  service: OnePasswordService,
  argv: string[],
  context: PluginCliContext,
): Promise<PluginCliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    return { exitCode: 0, stdout: `${HELP}\n` };
  }
  if (command === "status") {
    return statusCommand(service, parseArgs(rest, VALUE_FLAGS));
  }
  if (command === "unlock") {
    return unlockCommand(service, parseArgs(rest, VALUE_FLAGS));
  }
  if (command === "lock") {
    return lockCommand(service, parseArgs(rest, VALUE_FLAGS));
  }
  if (command === "vaults") {
    return vaultsCommand(service, parseArgs(rest, VALUE_FLAGS));
  }
  if (command === "granted") {
    return grantedCommand(service, parseArgs(rest, VALUE_FLAGS), context);
  }
  if (command === "request") {
    return requestCommand(service, parseArgs(rest, VALUE_FLAGS), context);
  }
  if (command === "inject") {
    return injectCommand(service, parseArgs(rest, VALUE_FLAGS), context);
  }
  if (command === "self-test") {
    return selfTestCommand(service, parseArgs(rest, VALUE_FLAGS), context);
  }
  if (command === "field") {
    const [action, ...fieldRest] = rest;
    const args = parseArgs(fieldRest, VALUE_FLAGS);
    if (action === "get") return fieldGetCommand(service, args, context);
    if (action === "set") return fieldSetCommand(service, args, context);
    if (action === "print") return fieldPrintCommand(service, args, context);
    throw new Error(`Unknown field command: ${action ?? ""}\n\n${HELP}`);
  }
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}
