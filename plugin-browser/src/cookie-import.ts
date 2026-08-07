// Copy cookies from the user's own Chrome into the managed browser.
//
// The on-disk profile database is the primary source. Attaching to the running
// Chrome over CDP works too, but Chrome asks the user to approve every new
// debugging connection, so it is reserved for when the database cannot be read.
import type { BrowserSession } from "./session.ts";
import {
  filterByDomains,
  type ChromeCookie,
  type CookieSource,
} from "./cookies.ts";
import { readProfileCookies, resolveProfile } from "./cookies-source-disk.ts";
import { readLiveChromeCookies } from "./cookies-source-live.ts";

export interface ImportOptions {
  /** Empty imports every cookie in the source. */
  domains: string[];
  /** Profile directory name; empty resolves to Chrome's last-used profile. */
  profile: string;
}

export interface ImportResult {
  source: CookieSource;
  /** The profile directory read, or null when the live source was used. */
  profile: string | null;
  /** Why the profile database was skipped, when the live source was used. */
  fallbackReason: string | null;
  scanned: number;
  imported: number;
  domains: string[];
}

export interface CookieReadResult {
  source: CookieSource;
  profile: string | null;
  fallbackReason: string | null;
  cookies: ChromeCookie[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readChromeCookies(
  options: ImportOptions,
): Promise<CookieReadResult> {
  const profile = await resolveProfile(options.profile);
  try {
    return {
      source: "profile-database",
      profile,
      fallbackReason: null,
      cookies: await readProfileCookies({ profile }),
    };
  } catch (databaseError) {
    const fallbackReason = messageOf(databaseError);
    try {
      return {
        source: "live-cdp",
        profile: null,
        fallbackReason,
        cookies: await readLiveChromeCookies(),
      };
    } catch (liveError) {
      throw new Error(
        `Could not read Chrome cookies. Profile database ("${profile}"): ${fallbackReason} Running Chrome: ${messageOf(liveError)}`,
      );
    }
  }
}

/** Cookies land in one session's context, never in another thread's. */
export async function importChromeCookies(
  session: BrowserSession,
  options: ImportOptions,
): Promise<ImportResult> {
  const { source, profile, fallbackReason, cookies } =
    await readChromeCookies(options);
  const selected = filterByDomains(cookies, options.domains);

  if (selected.length > 0) {
    await session.setCookies(
      selected.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        ...(cookie.expires >= 0 ? { expires: cookie.expires } : {}),
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
        ...(cookie.sourceScheme ? { sourceScheme: cookie.sourceScheme } : {}),
      })),
    );
  }

  return {
    source,
    profile,
    fallbackReason,
    scanned: cookies.length,
    imported: selected.length,
    domains: [
      ...new Set(selected.map((cookie) => cookie.domain.replace(/^\./, ""))),
    ].sort(),
  };
}
