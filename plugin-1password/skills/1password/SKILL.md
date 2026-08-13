---
name: 1password
description: Read and write 1Password items this BB project has been granted. Use when a task needs a credential, API key, or other secret stored in 1Password, or when the user asks to update a granted 1Password item.
---

# 1Password grants

Use `bb 1p`. Never call `op`. Each `op` invocation is a new shell and a new 1Password prompt.

If an item is not granted, request it. Do not ask the user to open the 1Password panel unless they want to browse vaults themselves.

```sh
bb 1p request op://vault/item --mode read --purpose "Need the API token to call the service"
bb 1p request op://vault/item --mode readwrite --purpose "Need to rotate the token"
```

That command replaces the composer with an Allow/Deny form. If the desktop session is locked, 1Password also prompts on this Mac. After Allow, inject. Do not `cat` the file.

```sh
bb 1p status
bb 1p granted
bb 1p inject --write-env .env.local NAME=op://vault/item/field
bb 1p field get op://vault/item/field --write-env .env.local --name NAME
bb 1p field get op://vault/item/field --out /tmp/secret.txt
bb 1p field set op://vault/item/field --from-file /tmp/secret.txt
```

`bb 1p field print` puts the secret in the transcript. Use it only when a file cannot work.

Batch every known `NAME=op://…` assignment into one `inject`.

When more than one account is locked or unlocked, pass `--account <id>` from `bb 1p status`.
