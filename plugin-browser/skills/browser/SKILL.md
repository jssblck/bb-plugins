---
name: browser
description: Drive a real Chrome browser from BB. Load pages, read content, click and type, screenshot, attach Playwright or Puppeteer, and copy Chrome cookies.
---

# The BB browser

Use this whenever a task needs a live browser: checking how a dev server
renders, reading a page that requires JavaScript or a login, reproducing a UI
bug, or scraping something behind a session.

Your thread has its own browser session, which the user watches live in this
thread's Browser panel. You drive it with `bb browser`, so the user sees every
page you load and can take over at any time.

Sessions are isolated: your tabs, cookies, and viewport are yours alone, and
nothing you do reaches an unrelated thread's browser. The session starts logged
out of everything, on a profile that is not the user's own Chrome.

Threads you spawn share your session. A subagent you send to read a page uses
your tabs and your imported cookies, so it does not need its own login, and it
can navigate a tab you were reading. Give each subagent its own tab with
`bb browser new` when they work at the same time.

## Common tasks

```sh
bb browser open https://example.com   # navigate the active tab
bb browser text                       # rendered text of the page
bb browser eval 'document.title'      # run JavaScript, get the JSON result
bb browser screenshot ./shot.png      # PNG written on YOUR machine
bb browser status                     # running state, tabs, CDP endpoint
```

Navigation is asynchronous. After `open`, wait for the page before reading it:

```sh
bb browser open https://example.com && sleep 2 && bb browser text
```

Prefer `text` over `html` when you only need content. On a real application page
`html` is often hundreds of kilobytes of markup.

Tabs are addressed by target id from `bb browser tabs`:

```sh
bb browser new https://example.com    # prints the new target id
bb browser select <targetId>          # also changes what the user sees
bb browser close <targetId>
```

## Signing in as the user

`bb browser cookies import` copies cookies out of the user's own Chrome. This is
what makes a page behind a login load for you:

```sh
bb browser cookies import github.com      # one domain
bb browser cookies import github.com app.slack.com
bb browser cookies import                 # every domain, which is a lot
```

Pass the domains you actually need. Importing everything hands the browser the
user's entire session state, and an agent-driven browser then acts as them
everywhere. The cookies land in your session only, so an unrelated thread's
browser stays signed out.

`bb browser cookies list [domain...]` shows which cookie names exist without
printing any values. Use it to check whether a session is available before you
navigate.

The import decrypts Chrome's profile cookie database, defaulting to the profile
Chrome last opened. It falls back to attaching to the running Chrome over CDP
only when the database cannot be read, and that fallback makes Chrome ask the
user to approve a debugging connection. The command output names the source it
used, so mention the fallback if you see it.

Cookies are a point-in-time copy, and Chrome writes them to disk on a timer. A
session the user created seconds ago may not be readable yet, so wait a moment
and import again rather than concluding it failed. If a session expires, import
again. Sites that keep auth in localStorage rather than cookies will still show
you signed out; say so rather than retrying the import.

## Full CDP access

For anything the CLI does not cover (network interception, request tracing, PDF
generation, multi-step automation), attach directly:

```sh
bb browser cdp            # prints ws://127.0.0.1:<port>/devtools/browser/<uuid>
bb browser cdp --json     # { browserWsUrl, httpUrl, port, browserContextId, activeTargetId }
```

One Chrome process serves every thread, so an attach can see other threads'
contexts. Always select your own by the `browserContextId` the command printed:

```js
// Puppeteer
const browser = await puppeteer.connect({ browserWSEndpoint: browserWsUrl });
const context = browser
  .browserContexts()
  .find((candidate) => candidate.id === browserContextId);
const page = await context.newPage();

// Playwright: read each context's id back over CDP, since it exposes no id
const browser = await chromium.connectOverCDP(httpUrl);
const context = (
  await Promise.all(
    browser.contexts().map(async (candidate) => {
      const page = candidate.pages()[0];
      if (!page) return null;
      const cdp = await candidate.newCDPSession(page);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      return targetInfo.browserContextId === browserContextId
        ? candidate
        : null;
    }),
  )
).find(Boolean);
```

Driving another thread's context takes over a browser someone else is using.

The endpoint and the context id both change when Chrome restarts, so read them
at the start of each run instead of caching them. Connecting does not take your
own browser over: the user's panel keeps rendering the active tab, and your
automation shows up live on their screen.

Leave the browser running when you finish. `bb browser stop` closes the session
and everything open in it, including the tabs of every thread sharing it, so
only use it when the user asked for it. An idle session closes itself after 30
minutes.
