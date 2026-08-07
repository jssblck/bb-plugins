// Read cookies straight out of the user's running Chrome over CDP.
//
// This is the fallback source. Chrome asks the user to approve every new
// debugging connection, so reaching for it means one dialog per import; prefer
// the profile database in cookies-source-disk.ts.
//
// Chrome writes DevToolsActivePort into its user-data-dir whenever remote
// debugging is on. The browser-target path in that file is a capability token,
// so being able to read the file is what authorizes the attach. We connect,
// take one snapshot, and disconnect immediately, so the plugin never keeps a
// handle on the user's personal browser.
import { CdpConnection } from "./cdp.ts";
import { readDevToolsEndpoint, realChromeUserDataDir } from "./chrome.ts";
import type { ChromeCookie } from "./cookies.ts";

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  sourceScheme?: "Unset" | "NonSecure" | "Secure";
}

export async function readLiveChromeCookies(
  userDataDir?: string,
): Promise<ChromeCookie[]> {
  const dir = userDataDir ?? realChromeUserDataDir();
  const endpoint = await readDevToolsEndpoint(dir);
  if (!endpoint) {
    throw new Error(
      `No DevToolsActivePort in ${dir}. Chrome is not running with a remote debugging port.`,
    );
  }

  let connection: CdpConnection;
  try {
    connection = await CdpConnection.connect(endpoint.browserWsUrl, 5000);
  } catch {
    throw new Error(
      `Chrome is not listening on port ${endpoint.port}, or the connection was not approved.`,
    );
  }
  try {
    const { cookies } = await connection.send<{ cookies: CdpCookie[] }>(
      "Storage.getCookies",
    );
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.session ? -1 : cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      sourceScheme: cookie.sourceScheme,
    }));
  } finally {
    connection.close();
  }
}
