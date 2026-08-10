---
name: goal
description: Set, run, and end a durable thread goal with `bb goal`. Use when the user says /goal, asks to "set a goal", "keep working until X", or hands over open-ended work whose next step depends on what the last step found - performance tuning, flaky test hunts, dependency migrations, bug reproduction, multi-step refactors, or research. Also use when an active goal is running and you need to know how to report its outcome.
---

# Goals

A goal is a thread's completion condition: what should be true, how success is
checked, and what must not regress. A normal prompt says do the next thing. A
goal says keep working until this outcome is true.

While a goal is active, bb restates it in every turn and sends the thread a new
continuation each time it goes idle, up to an iteration budget. The goal ends
when you call `goal_report` or the budget runs out.

## When a goal is the right tool

Use a goal when the next step depends on what the last step found: performance
work, flaky test investigations, dependency migrations, bug hunts that need a
reproduction, multi-step refactors, benchmark-driven tuning, and research.

Do not use a goal for a one-line edit, an explanation, a short review, or a
question with one answer. Those finish in a turn, and a goal only adds
continuations that have nothing to do.

## Writing the objective

State the outcome, the verification, and the constraints in one paragraph. A
useful template:

> `<desired end state>` verified by `<specific evidence>` while preserving
> `<constraints>`. Use `<allowed files, tools, and data>`. Between iterations,
> `<how to choose the next attempt>`. If blocked, report `<what to report>`.

Weak: `Improve performance`

Strong: `Cut p95 checkout latency below 120 ms, verified by
scripts/bench-checkout.sh, while keeping the correctness suite green. Work only
in services/checkout and its tests. Between iterations, profile before changing
anything. If blocked, report the profile and what you would need.`

The objective is injected into every turn, so keep it under 2000 characters and
state the outcome, not the plan.

## Commands

```
bb goal set <objective> [--iterations N]  Set the goal and start working toward it
bb goal show [--json]                     The goal, its status, and iterations used
bb goal pause                             Stop continuing the thread
bb goal resume [--iterations N]           Continue again, with a new budget if spent
bb goal clear                             Discard the goal
bb goal list [--json]                     Every thread that has a goal
```

Every command acts on the calling thread; `--thread <id>` targets another one.
`--iterations` defaults to 10 continuations. When the user asks for a goal,
write the strong objective yourself from what they said, run `bb goal set`, and
show them the objective you registered.

## Running a goal

- Keep working until the outcome is true. Do not stop at a plausible answer and
  do not hand the work back while the goal is active.
- Verify against real evidence: test output, benchmark numbers, logs, file
  contents. A goal is not complete because the work looks done.
- Change approach when an attempt fails. Repeating a failed attempt spends an
  iteration for nothing.

## Ending a goal

Call the `goal_report` tool. It is the only way to end a goal from inside the
thread:

- `outcome: "complete"` with the evidence that proves the outcome, quoted.
- `outcome: "blocked"` with what is missing: access, a decision, a broken
  assumption, or the same failure twice.

Never report completion you have not verified. If the budget runs out first,
the goal stops itself and the user decides whether to resume it.

## Codex threads

Codex runs its own goal loop. On a Codex thread use its native `/goal` command;
`bb goal set` refuses rather than steering the thread from two places at once.
