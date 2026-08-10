# Goal

`plugin-goal` gives a bb thread a durable objective it keeps working toward
across turns.

A goal is a completion condition: what should be true, how success is checked,
and what must not regress. While one is active, bb restates it in every turn and
continues the thread each time it goes idle, up to an iteration budget. The goal
ends when the agent reports a verified outcome, when it reports that it is
blocked, or when the budget runs out.

Codex has this built in, and bb already renders its goals. This plugin gives
every other provider the same thing, so a Claude Code thread can hold an
objective too.

## Use it

```sh
bb goal set "Cut p95 checkout latency below 120 ms, verified by \
scripts/bench-checkout.sh, while keeping the correctness suite green. Work only \
in services/checkout and its tests." --iterations 15
bb goal show
bb goal pause
bb goal resume --iterations 30
bb goal clear
bb goal list
```

Every command acts on the calling thread; `--thread <id>` targets another one.
`--iterations` defaults to 10. The thread header shows the goal's status and
iteration count, and opens a dialog to pause, resume, or clear it.

The bundled `goal` skill teaches agents when a goal is the right tool, how to
write the objective, and how to end one. Typing `/goal` in the composer loads
it.

## How it runs

- **Instructions.** While the goal is active, its objective and the remaining
  budget are appended to every turn's instructions.
- **Continuation.** On each `thread.idle` event with an active goal, the plugin
  sends the thread an agent-only continuation message and spends one iteration.
  Setting a goal on an idle thread starts the first one right away. A thread
  that is busy is left alone and picked up on the next idle event, so a goal
  never interrupts the user.
- **Completion.** The `goal_report` tool ends the goal as `complete` with the
  evidence, or `blocked` with what is missing. Nothing else marks a goal
  complete.
- **Budget.** After `--iterations` continuations the goal stops itself as
  `budget-limited`. `bb goal resume` grants a fresh budget.
- **Failures.** A `thread.failed` event pauses the goal instead of spending the
  rest of the budget on the same error.
- **Codex.** `bb goal set` refuses on a thread that already has a native Codex
  goal, and an active plugin goal pauses itself if one appears, so a thread is
  never steered by two goal loops.

Goal state lives in the plugin's own SQLite database, keyed by thread. Archiving
or deleting a thread discards its goal.

## Install

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
