# bb-plugin-stay-awake

Blocks macOS idle sleep while bb runs. Agents keep working while you are away
from the machine, and remote access over `bb connect` stays reachable, because
the tunnel needs the local bb process to stay awake.

## How it works

While the plugin is loaded it runs `caffeinate -i`, which holds one power
assertion: `PreventUserIdleSystemSleep`. Everything else still sleeps normally.

- The display sleeps on its own schedule, and the screen still locks.
- The disks still spin down.
- Closing the lid still sleeps the machine. Clamshell sleep is a forced sleep
  that idle assertions do not block.
- Explicit sleep still works: the Apple menu, `pmset sleepnow`, and the power
  button.

The assertion is released when the plugin is disabled or reloaded, and when bb
shuts down. `caffeinate` also runs with `-w <bb pid>`, so it exits on its own if
the bb server dies without running its cleanup hooks.

On Linux and Windows the plugin holds no assertion and reports
`needs-configuration`.

## Install

From this directory:

```sh
npm install
bb plugin install . --yes
```

After editing sources, reload:

```sh
bb plugin reload stay-awake
```

## Verify

Confirm the assertion is held:

```sh
pmset -g assertions | grep caffeinate
```

`bb plugin logs stay-awake` records each time the assertion is taken and
released.

## Turn it off

```sh
bb plugin disable stay-awake
```
