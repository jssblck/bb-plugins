# 1Password

`plugin-1password` lets you grant a bb project access to selected 1Password
items, then lets agents read and write those items without calling `op`.

1Password CLI authorizes a TTY. Every agent shell is a new TTY, so every `op`
call is a new biometric prompt. This plugin authenticates the bb server
process through the 1Password JS SDK instead. Unlock once in the panel. Agents
then use `bb 1p` against the grants you chose.

## Use it

1. Open the **1Password** sidebar panel.
2. Pick an account and click **Unlock**. Approve the prompt on this Mac.
3. Pick a project. Grant items (or a whole vault) as **Read** or **Read/write**.
4. In a thread in that project, either grant items in the panel or let the
   agent request one:

```sh
bb 1p request op://Dev/MyApp --mode read --purpose "Need the API token"
bb 1p inject --write-env .env.local API_KEY=op://Dev/MyApp/credential
```

If the desktop session is locked, 1Password prompts on this Mac. The item
grant itself is an Allow/Deny form in the thread.

Lock in the panel, or lock the 1Password app, to end the session. The next
agent call fails with an unlock instruction instead of popping Touch ID.

`bb 1p` writes files on the thread's host. It prints paths and names, not
secret values. `bb 1p field print` is the exception; the bundled skill tells
agents not to use it unless a file cannot work.

## Install

Requires 1Password for Mac with **Settings → Developer → Integrate with other
apps** turned on, plus 1Password CLI on PATH (`op`) so the plugin can list
accounts.

```sh
npm install
bb plugin install . --yes
```

## Develop

```sh
npm run typecheck
npm test
bb plugin dev
```
