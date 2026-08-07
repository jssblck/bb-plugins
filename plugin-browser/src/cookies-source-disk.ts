// Read cookies out of Chrome's on-disk profile when the live browser is not
// attachable.
//
// Chrome encrypts each cookie value with AES-128-CBC under a key derived from
// the macOS Keychain item "Chrome Safe Storage". Reading that item raises a
// one-time Keychain prompt. Chrome M130+ additionally prefixes the plaintext
// with SHA-256 of the cookie's host key, which we strip when present.
import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { realChromeUserDataDir } from "./chrome.ts";
import type { ChromeCookie } from "./cookies.ts";

const run = promisify(execFile);

const KEYCHAIN_SERVICE = "Chrome Safe Storage";
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const AES_IV = Buffer.alloc(16, 0x20);
/** SQLite sidecars Chrome may have alongside the cookie database. */
const DB_SIDECARS = ["-journal", "-wal", "-shm"];

interface CookieRow {
  domain: string;
  name: string;
  path: string;
  expires: number;
  secure: number;
  httpOnly: number;
  samesite: number;
  sourceScheme: number;
  plainValue: string;
  encHex: string;
}

const COOKIE_QUERY = `
  SELECT host_key AS domain,
         name,
         path,
         CASE WHEN expires_utc = 0 THEN -1
              ELSE (expires_utc / 1000000) - 11644473600 END AS expires,
         is_secure AS secure,
         is_httponly AS httpOnly,
         samesite,
         source_scheme AS sourceScheme,
         value AS plainValue,
         hex(encrypted_value) AS encHex
  FROM cookies
`;

/**
 * The profile directory to read when the user has not named one. Chrome records
 * the profile it last opened in Local State, which is the one whose sessions
 * they are actually using. Guessing "Default" instead silently imports a
 * different account's cookies on a multi-profile install.
 */
export async function resolveProfile(
  preferred: string,
  userDataDir?: string,
): Promise<string> {
  const trimmed = preferred.trim();
  if (trimmed) return trimmed;
  const dir = userDataDir ?? realChromeUserDataDir();
  try {
    const raw = await readFile(join(dir, "Local State"), "utf8");
    const lastUsed = (JSON.parse(raw) as { profile?: { last_used?: string } })
      .profile?.last_used;
    if (lastUsed && existsSync(join(dir, lastUsed, "Cookies"))) return lastUsed;
  } catch {
    // No Local State, or it is unreadable; fall through to the default name.
  }
  return "Default";
}

/** Profile directory names under the Chrome user-data-dir that hold cookies. */
export async function listChromeProfiles(
  userDataDir?: string,
): Promise<string[]> {
  const dir = userDataDir ?? realChromeUserDataDir();
  let entries: string[];
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .filter((name) => existsSync(join(dir, name, "Cookies")))
    .sort();
}

export async function readProfileCookies(options: {
  profile: string;
  userDataDir?: string;
}): Promise<ChromeCookie[]> {
  if (process.platform !== "darwin") {
    throw new Error(
      `Reading Chrome's cookie database is only implemented for macOS (this is ${process.platform}). Run Chrome with a remote debugging port to use the live source instead.`,
    );
  }
  const userDataDir = options.userDataDir ?? realChromeUserDataDir();
  const source = join(userDataDir, options.profile, "Cookies");
  if (!existsSync(source)) {
    throw new Error(`No cookie database at ${source}`);
  }

  const key = deriveKey(await readKeychainPassword());
  const workDir = await mkdtemp(join(tmpdir(), "bb-browser-cookies-"));
  try {
    const copy = join(workDir, "Cookies");
    await copyFile(source, copy);
    for (const suffix of DB_SIDECARS) {
      if (existsSync(source + suffix))
        await copyFile(source + suffix, copy + suffix);
    }
    const rows = await queryCookies(copy);
    return rows.map((row) => toChromeCookie(row, key));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function readKeychainPassword(): Promise<string> {
  const attempts = [
    ["find-generic-password", "-w", "-s", KEYCHAIN_SERVICE, "-a", "Chrome"],
    ["find-generic-password", "-w", "-s", KEYCHAIN_SERVICE],
  ];
  let lastError = "";
  for (const args of attempts) {
    try {
      const { stdout } = await run("/usr/bin/security", args);
      const password = stdout.replace(/\n$/, "");
      if (password) return password;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `Could not read the "${KEYCHAIN_SERVICE}" Keychain item. Approve the Keychain prompt and retry. (${lastError})`,
  );
}

function deriveKey(password: string): Buffer {
  return pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, 16, "sha1");
}

async function queryCookies(dbPath: string): Promise<CookieRow[]> {
  const binaries = ["/usr/bin/sqlite3", "sqlite3"];
  let lastError = "";
  for (const binary of binaries) {
    try {
      const { stdout } = await run(binary, ["-json", dbPath, COOKIE_QUERY], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const trimmed = stdout.trim();
      return trimmed ? (JSON.parse(trimmed) as CookieRow[]) : [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `Could not query the cookie database with sqlite3: ${lastError}`,
  );
}

function toChromeCookie(row: CookieRow, key: Buffer): ChromeCookie {
  const encrypted = row.encHex
    ? Buffer.from(row.encHex, "hex")
    : Buffer.alloc(0);
  const value =
    decryptValue(encrypted, row.domain, key) ?? row.plainValue ?? "";
  return {
    name: row.name,
    value,
    domain: row.domain,
    path: row.path,
    expires: row.expires,
    httpOnly: row.httpOnly === 1,
    secure: row.secure === 1,
    sameSite: SAME_SITE[row.samesite],
    sourceScheme: SOURCE_SCHEME[row.sourceScheme] ?? "Unset",
  };
}

const SAME_SITE: Record<number, ChromeCookie["sameSite"]> = {
  0: "None",
  1: "Lax",
  2: "Strict",
};

const SOURCE_SCHEME: Record<number, ChromeCookie["sourceScheme"]> = {
  0: "Unset",
  1: "NonSecure",
  2: "Secure",
};

function decryptValue(
  encrypted: Buffer,
  hostKey: string,
  key: Buffer,
): string | null {
  if (encrypted.length <= 3) return null;
  const version = encrypted.subarray(0, 3).toString("latin1");
  if (version !== "v10" && version !== "v11") return null;

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, AES_IV);
    decipher.setAutoPadding(false);
    plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(3)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }

  const padding = plaintext.at(-1) ?? 0;
  if (padding >= 1 && padding <= 16 && padding <= plaintext.length) {
    plaintext = plaintext.subarray(0, plaintext.length - padding);
  }
  return stripDomainHash(plaintext, hostKey).toString("utf8");
}

/** M130+ prepends SHA-256 of the host key to the plaintext. */
function stripDomainHash(plaintext: Buffer, hostKey: string): Buffer {
  if (plaintext.length < 32) return plaintext;
  const prefix = plaintext.subarray(0, 32);
  for (const candidate of [hostKey, hostKey.replace(/^\./, "")]) {
    if (prefix.equals(createHash("sha256").update(candidate).digest())) {
      return plaintext.subarray(32);
    }
  }
  return plaintext;
}
