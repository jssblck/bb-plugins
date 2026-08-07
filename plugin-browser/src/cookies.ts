// Shared cookie shape and domain matching for both import sources.

export interface ChromeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since the epoch, or -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  sourceScheme?: "Unset" | "NonSecure" | "Secure";
}

export type CookieSource = "live-cdp" | "profile-database";

export interface CookieReadResult {
  source: CookieSource;
  cookies: ChromeCookie[];
}

/** `github.com` matches `github.com` and `.api.github.com`, not `notgithub.com`. */
export function matchesDomain(hostKey: string, domain: string): boolean {
  const host = hostKey.replace(/^\./, "").toLowerCase();
  const wanted = domain.replace(/^\./, "").toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`);
}

export function filterByDomains(
  cookies: ChromeCookie[],
  domains: string[],
): ChromeCookie[] {
  if (domains.length === 0) return cookies;
  return cookies.filter((cookie) =>
    domains.some((domain) => matchesDomain(cookie.domain, domain)),
  );
}

/** The registrable-ish host of a URL, used to default the import filter. */
export function domainOfUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}
