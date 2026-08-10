# bb-plugin-browser

Lets bb agents drive the user's own Chrome. A browser extension holds the
browser side, a native messaging host bridges it to bb, and each thread binds
one tab. The pages, the profile, the extensions, and the logged-in sessions are
the user's own, so an agent reaches anything the user can reach without a
single login or cookie import.

This is the architecture the Codex and Claude desktop apps use. It replaced an
earlier design where bb launched its own headless Chrome and copied cookies
into it. Copying cookies misses `localStorage` and IndexedDB tokens, so Google,
Slack, and most OAuth apps stayed logged out. A managed browser also cannot be
hidden on macOS: the window server pulls an off-screen window back on screen,
and minimizing one stops its screencast frames.

## How it works

```
bb plugin  <--unix socket-->  native host  <--stdio-->  extension  <--CDP-->  tabs
```

- **The extension** (`extension/`) is unpacked and pinned to the id
  `chabhnkncinakogfdckllfckfdegbiji` by the public key in its manifest, so the
  native host manifest can name it wherever the folder lives. It reads pages
  with `chrome.scripting`, which needs no debugger session, and attaches
  `chrome.debugger` only for input, arbitrary JavaScript, and screenshots.
  Chrome shows its debugging banner while that session is attached.
- **The native host** (`native-host/bridge.mjs`) owns no state. Chrome starts
  it, and it reframes Chrome's length-prefixed messages onto bb's unix socket
  and back. A wrapper script generated at install time carries the absolute
  paths, so bb rewrites it on every load.
- **The plugin** listens on the socket, correlates requests with responses, and
  binds one tab per thread. Bindings are durable, because a thread comes back
  to its page across turns and restarts, and verified on every use, because the
  user can close the tab at any time.

Sessions are keyed by thread. A spawned thread shares its parent's tab, so a
workflow's subagents and their coordinator drive one page. A fork is a peer
exploration, so it starts unbound.

Tab etiquette follows the agent skill: agent tabs open in the background, the
user's own tabs stay theirs until an agent attaches to one, and releasing drops
the debug session so the banner disappears.

## Setup

`bb browser install` writes the native messaging manifest into every installed
Chromium-family browser profile, generates the host wrapper, and prints the
rest. The plugin also writes those files on every load, so they never go stale.

Loading the extension is manual and one time:

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Load unpacked, and choose this plugin's `extension/` directory

Branded Chrome ignores `--load-extension`, so there is no scripted path.

## Commands

Run `bb browser` for the full list. The common ones:

```sh
bb browser open <url>
bb browser text
bb browser eval <expression>
bb browser click <selector>
bb browser type <selector> <text> [--submit]
bb browser screenshot <path>
bb browser tabs
bb browser attach <tabId>
bb browser release
```

## Development

```sh
npm install
npx tsc --noEmit
bb plugin dev          # rebuild + reload on save
bb plugin logs browser -f
```

Extension changes need a reload in `chrome://extensions` to take effect. A
stale service worker keeps running the old code without complaining.

End-to-end testing without touching the user's browser: Google Chrome refuses
`--load-extension`, but Chrome for Testing accepts it, so a throwaway profile
with the manifest copied into `<user-data-dir>/NativeMessagingHosts/` runs the
whole stack.

The extension id is pinned by a public key. Its private half is not in this
repo and is only needed to package a `.crx`, which unpacked loading does not
use.
