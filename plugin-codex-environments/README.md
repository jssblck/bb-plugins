# Codex Environments for bb

This bb plugin reads Codex local environment files from
`.codex/environments/*.toml`. It uses the same version 1 file format as the
[Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment)
feature.

## Behavior

- The new-thread options row selects the environment for new managed worktrees.
- Setup runs once after bb finishes provisioning a selected worktree.
- Cleanup starts when bb begins retiring or destroying that worktree.
- Environment actions run in bb terminals scoped to the worktree.
- Long-running actions, such as development servers and test watchers, remain
  available in the environment panel until stopped.
- `darwin`, `linux`, and `win32` script and action overrides follow the Codex
  format.
- Scripts receive `CODEX_SOURCE_TREE_PATH` and `CODEX_WORKTREE_PATH`.
- The bundled `environment-files` skill teaches agents how to create and update
  these files. bb provides it to every agent provider in new threads.

The bb plugin API reports teardown transitions but does not provide a blocking
pre-destroy hook. Cleanup starts immediately on that transition. bb can still
remove the worktree before a long cleanup script finishes.

## Environment file

```toml
version = 1
name = "web"

[setup]
script = "npm install"

[setup.darwin]
script = "brew bundle"

[cleanup]
script = "docker compose down --remove-orphans"

[[actions]]
name = "Run"
icon = "run"
command = "npm run dev"

[[actions]]
name = "Test"
icon = "test"
command = "npm test"
platform = "linux"
```

Supported action icons are `tool`, `run`, `debug`, and `test`.

## Install

```sh
bb plugin install .
```

Open the inline "Codex environment" control when composing a new thread. Select
a valid environment file before creating the worktree. In a worktree thread,
use the "Env" header control or the "Environment actions" panel entry. Ask any
agent to configure the environment file when the project setup changes.

## Development

```sh
npm test
npm run typecheck
bb plugin build
bb plugin reload codex-environments
```
