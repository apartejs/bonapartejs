---
name: phase-gate
description: Use when the last task of a phase of the implementation plan is done, before starting the next phase. Runs the gate that ends a phase - whole suite, real-model smoke when the engine changed, review, documents up to date, screenshots, and the summary for Paul in French.
---

# Phase gate

A phase of the plan (`docs/superpowers/plans/2026-11-14-bonaparte-v1-plan.md`)
is done when this gate has passed, not when its last task has. Work through it
in order. Stop at the first failure, fix the cause, and start the gate again.

## 1. The whole suite

Run every command and read its output. A command that does not exist yet (the
workspace arrives in phase 1) is skipped, and you say so in the summary.

```sh
node --test ".claude/hooks/*.test.mjs"
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @aparte/bonaparte-app test:e2e
```

The end-to-end tests must not bring a window to the foreground.

The first command is also what notices a private file that became tracked: it
fails if anything `.gitignore` keeps out is in the index. Never answer that
failure by forcing a file in; `git rm --cached` it.

## 2. The real-model smoke

Only when the phase touched the engine, the prompt, the KV memory or the agent
loop. Use the `smoke` skill: it announces the cost to Paul before it loads a
model, and records the results.

## 3. The review

Dispatch the `reviewer` agent with: the phase number, the commit range of the
phase (`BASE..HEAD`, where BASE is the commit the phase started from), the
paths of the plan and of the design document, and the path of the ledger with
its `Ruling:` lines.

Fix every Critical and Important finding in one pass. Each fix starts with a
test that fails for the finding, then passes. Minor findings go to the ledger
and to the summary; they are not fixed here.

## 4. The documents

- `AGENTS.md`: the commands, the landmarks, and the smoke results of the phase.
- `docs/superpowers/plans/SUIVI.md`: the phase is "faite"; decisions taken on
  the way; questions for Paul; frictions filed on aparté.
- The plan's checkboxes for the phase are ticked.

## 5. The screens

When the phase has screens, capture each one in light and dark, in French and
in English, into `docs/superpowers/screens/phase-NN/`, and compare it with its
board (the `screen` skill says how). Note every difference in `SUIVI.md`.

## 6. The summary for Paul

In French, short, in this order:

1. What works now, and how to see it (the command, the screen).
2. What was not verified, and why.
3. Decisions taken on his behalf, each with what it costs if it is wrong.
4. Questions that need him.

A phase stays "faite" until Paul has seen it. Only he marks it "validée".

## Never

- Never push, never tag, never merge into `main`. The branch stays local.
- Never mark a phase "validée par Paul" yourself.
- Never skip the review because the diff looks small.
