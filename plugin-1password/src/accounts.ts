import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { errorMessage, OnePasswordError } from "./errors.ts";
import type { Account } from "./types.ts";

const execFileAsync = promisify(execFile);

interface OpAccountRow {
  url?: unknown;
  email?: unknown;
  account_uuid?: unknown;
}

export async function listDesktopAccounts(): Promise<Account[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "op",
      ["account", "list", "--format", "json"],
      { timeout: 10_000 },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new OnePasswordError(
      `Could not list 1Password accounts with \`op\`: ${errorMessage(error)}. Install 1Password CLI and turn on Settings → Developer → Integrate with 1Password CLI.`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new OnePasswordError("op account list returned invalid JSON.", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new OnePasswordError("op account list did not return an array.");
  }
  return parsed.map(parseAccount);
}

function parseAccount(raw: unknown): Account {
  if (raw === null || typeof raw !== "object") {
    throw new OnePasswordError("op account list contained a non-object row.");
  }
  const row = raw as OpAccountRow;
  if (
    typeof row.account_uuid !== "string" ||
    typeof row.url !== "string" ||
    typeof row.email !== "string"
  ) {
    throw new OnePasswordError(
      "op account list row was missing account_uuid, url, or email.",
    );
  }
  return { id: row.account_uuid, url: row.url, email: row.email };
}
