# bb plugins

This repository contains independently maintained plugins for bb. Each plugin
is a self-contained package that can contribute server behavior, UI, commands,
and agent skills.

## Plugins

### Browser

`plugin-browser` lets bb agents drive the user's own Chrome through a browser
extension and a native messaging host. Agents work in the user's real profile
and logged-in sessions through the `bb browser` command or the thread's Browser
panel.

[Browser documentation](plugin-browser/README.md)

### Codex Environments

`plugin-codex-environments` lets bb use Codex-compatible
`.codex/environments/*.toml` files for worktree setup, cleanup, and services. It
also contributes a provider-neutral skill that teaches agents to maintain those
files.

[Codex Environments documentation](plugin-codex-environments/README.md)

### Goal

`plugin-goal` gives a thread a durable objective it keeps working toward across
turns. bb restates the goal in every turn and continues the thread each time it
goes idle, until the agent reports a verified outcome or the iteration budget
runs out. Codex has this built in; this plugin brings it to every other
provider.

[Goal documentation](plugin-goal/README.md)

### 1Password

`plugin-1password` lets you grant a project access to selected 1Password items.
Agents then read and write those items with `bb 1p` instead of calling `op` in
a new shell, which is what was causing a 1Password prompt on every secret.

[1Password documentation](plugin-1password/README.md)

### Stay Awake

`plugin-stay-awake` blocks macOS idle sleep while bb runs, so agents keep
working and `bb connect` stays reachable. The display still sleeps on its own
schedule, and closing the lid still sleeps the machine.

[Stay Awake documentation](plugin-stay-awake/README.md)

## Install a plugin

Clone the repository, install the selected package's dependencies, then install
that directory into bb:

```sh
git clone https://github.com/jssblck/bb-plugins.git
cd bb-plugins/plugin-codex-environments
npm install
bb plugin install . --yes
```

Use `plugin-browser` instead to install the browser plugin.

## Development

Run checks from the plugin directory. Each package documents its own commands
and runtime behavior in its README.

## Public repository policy

Everything committed here is public. Do not commit credentials, private data,
private code, internal URLs, local machine details, or content copied from a
private source. See [AGENTS.md](AGENTS.md) for the required pre-push checks.
