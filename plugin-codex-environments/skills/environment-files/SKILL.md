---
name: environment-files
description: Create and maintain Codex-compatible local environment files for BB worktrees. Use whenever a user asks to configure worktree setup or cleanup, install project dependencies in new worktrees, add development servers or common project actions, edit .codex/environments files, or make BB and Codex share an environment configuration. Use this for any agent provider running inside BB, not only Codex.
---

# Local environment files

Configure project worktrees through `.codex/environments/*.toml`. BB and Codex
read the same files, so keep the configuration provider-neutral. Do not add
BB-specific keys.

## Workflow

1. Find the project root and inspect `.codex/environments/*.toml`.
2. Read the project manifests and scripts needed for setup, cleanup, and actions.
3. Update the existing file when one environment already covers the project.
4. Create `.codex/environments/environment.toml` when no file exists.
5. Add another file only when the user needs a distinct selectable environment.
6. Check the TOML syntax and every referenced command before finishing.

Keep setup safe to run in a newly created worktree. Make it idempotent where
possible. Install dependencies, copy generated local files, or perform an
initial build there. Do not start a long-running service during setup.

Put development servers, test watchers, and other interactive commands in
actions. BB runs each action in a worktree terminal and keeps long-running
commands available until the user stops them.

Use cleanup for worktree-scoped external resources, such as containers,
ephemeral databases, or service links. Make cleanup safe when setup completed
only partially. Do not delete project data outside the worktree unless the user
explicitly requires it.

Never commit credentials or secret values. Refer to the project's existing
secret-loading mechanism instead.

## File format

Every file needs `version = 1`, a non-empty `name`, and a default setup script.
Use TOML multiline literal strings for multi-command shell scripts.

```toml
version = 1
name = "web"

[setup]
script = '''
npm install
npm run build
'''

[cleanup]
script = '''
docker compose down --remove-orphans
'''

[[actions]]
name = "Dev"
icon = "run"
command = "npm run dev"

[[actions]]
name = "Test"
icon = "test"
command = "npm test"
```

Supported action icons are `tool`, `run`, `debug`, and `test`. Omit `icon` when
none describes the command.

## Platform-specific commands

The default setup script remains required. Override it for a host platform only
when the commands differ:

```toml
[setup]
script = "npm install"

[setup.darwin]
script = "brew bundle && npm install"

[setup.win32]
script = "npm.cmd install"
```

The same override structure works for `cleanup`. An action can target one
platform with `platform = "darwin"`, `"linux"`, or `"win32"`:

```toml
[[actions]]
name = "macOS app"
icon = "run"
command = "npm run dev:mac"
platform = "darwin"
```

Prefer portable commands over duplicate platform sections when practical.

## Paths and shell state

Scripts run from the active worktree. They receive these variables:

- `CODEX_WORKTREE_PATH`: the active worktree root.
- `CODEX_SOURCE_TREE_PATH`: the original project checkout root.

Quote both variables when using them in shell commands. Setup shell exports do
not persist into later actions. Store reusable state through the project's
normal files or tooling instead of relying on exported variables.

## Completion checks

- The file is under the project root at `.codex/environments/*.toml`.
- Required fields exist and the TOML parses.
- Setup finishes without leaving a foreground service running.
- Cleanup tolerates a partially configured worktree.
- Action commands exist and long-running services stay in actions.
- The file contains no secrets or provider-specific extensions.
