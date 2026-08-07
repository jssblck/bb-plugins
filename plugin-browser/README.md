# bb-plugin-browser

A Chrome browser view inside BB, one per thread. The user watches and drives a
thread's browser in that thread's side panel; the thread's agent drives the same
browser over a CLI and its Chrome DevTools Protocol endpoint. Session cookies
can be copied in from the user's own Chrome so the browser is logged in as they
are.

## How it works

BB launches one headless Chrome with a dedicated profile under
`<dataDir>/plugins/browser/chrome-profile` and a debugging port on loopback.

- **Sessions are per thread.** Each thread gets its own CDP browser context, so
  its tabs, active tab, cookies, storage, and viewport are isolated from every
  other thread the way incognito windows are isolated from each other. One
  Chrome process backs them all. A `bb browser` call made outside a thread lands
  on a shared scratch session.
- **A spawned thread shares its parent's session**, so a workflow's subagents
  and their coordinator drive one browser and one cookie jar. The session key is
  the root of the thread's parent chain. A fork is a peer exploration rather
  than a subagent, so it starts a session of its own.
- **The view** is a CDP screencast. Frames leave the plugin as a
  `multipart/x-mixed-replace` JPEG stream that an `<img>` tag renders natively,
  so video never travels as JSON over RPC. Mouse and keyboard events go back
  over RPC as normalized coordinates and `Input.dispatchKeyEvent` fields.
- **Agent access** is the raw CDP endpoint. `bb browser cdp` prints a WebSocket
  URL that Playwright, Puppeteer, or a hand-rolled client can attach to, plus
  the calling thread's browser context id. One Chrome serves every thread, so an
  attach sees other threads' contexts too and must select its own. The user's
  panel keeps rendering while automation drives the page.
- **The cookie bridge** decrypts the user's Chrome cookie database with the
  macOS Keychain key, and falls back to attaching to their running Chrome over
  CDP when the database cannot be read. The database is the primary source
  because Chrome asks the user to approve every new debugging connection, so a
  CDP-first bridge means a dialog on every import. Cookies land in the calling
  thread's context through `Storage.setCookies`, so one thread's import never
  signs another thread in.

The managed browser is never the user's own browser. Nothing an agent does
touches their real profile, and the plugin only ever reads from it.

A session closes when the thread that owns it is archived or deleted, when
`bb browser stop` runs in it, or after 30 minutes with no command and nobody
watching its panel. Losing a subagent leaves its coordinator's browser alone,
because a subagent's id is never a session key. Chrome itself exits once the
last session closes.

## Commands

Run `bb browser` for the full list. The common ones:

```sh
bb browser open <url>
bb browser text
bb browser eval <expression>
bb browser screenshot <path>
bb browser cdp
bb browser cookies import [domain...]
```

## Settings

`cookieProfile` sets which Chrome profile directory the cookie source reads, for
example `Default` or `Profile 1`. Leave it blank and the plugin reads the
profile Chrome last opened, from `profile.last_used` in Chrome's `Local State`.
Set it only when you want a profile other than the one you browse with.

## Development

```sh
npm install
npx tsc --noEmit
bb plugin dev          # rebuild + reload on save
bb plugin logs browser -f
```
