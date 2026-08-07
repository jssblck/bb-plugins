# bb plugins

This repository contains independently maintained plugins for bb. Each plugin
is a self-contained package that can contribute server behavior, UI, commands,
and agent skills.

## Plugins

### Browser

`plugin-browser` adds a per-thread Chrome browser to bb. Users and agents share
the same session through the side panel, the `bb browser` command, or Chrome
DevTools Protocol.

[Browser documentation](plugin-browser/README.md)

### Codex Environments

`plugin-codex-environments` lets bb use Codex-compatible
`.codex/environments/*.toml` files for worktree setup, cleanup, and services. It
also contributes a provider-neutral skill that teaches agents to maintain those
files.

[Codex Environments documentation](plugin-codex-environments/README.md)

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
