---
name: run-app
description: Use to see a change working in the real bonaparte app - to launch it, drive it, take a screenshot, or run its end-to-end tests - and whenever you are about to start any process on Windows. Launches without ever opening a visible console window.
---

# Running the app

## The rule that comes first

Never open a visible console window. On Windows a new console window takes the
foreground and throws the person out of whatever they were doing.

- Run commands through the Bash or PowerShell tool, or in the background.
- To start a separate process: `Start-Process ... -WindowStyle Hidden`, or
  `-NoNewWindow`. Never `Start-Process` without one of them.
- Never `start`, `cmd /c start`, `wt`, `conhost`, or `Invoke-Item` on a `.bat`
  or `.cmd` file.
- In code, every child process goes through `spawnHidden`.
- If a window really has to be shown, ask first.

The guard in `.claude/hooks/guard-command.mjs` refuses these forms. If it
blocks you, change the command; do not look for a way around it.

## Prefer the end-to-end tests

They are the usual way to see a change: they launch the built app against the
fake llama-server, with `BONAPARTE_E2E=1`, so that its window never comes to
the foreground.

```sh
pnpm build
pnpm --filter @aparte/bonaparte-app test:e2e
pnpm --filter @aparte/bonaparte-app test:e2e -- e2e/stream.spec.ts
```

Screenshots and traces of a failing spec are in
`packages/app/test-results/`. Read the screenshot rather than guessing.

## Launching the app by hand

Run the dev command in the background, never in a new terminal:

```sh
pnpm dev
```

- With no engine configured, the app starts and loads nothing: launching the
  app never loads a model.
- To talk to a llama.cpp server that is already running, set
  `BONAPARTE_LLAMA_URL` before launching.
- To keep the app's data out of the real profile, set `BONAPARTE_DATA_DIR` to
  a temporary folder.

Stop it by ending the background task. Then check that nothing is left: no
`electron` process, and no `llama` process that the app started.

## Showing the result

Screens meant for Paul go to `docs/superpowers/screens/phase-NN/`, in light
and dark, in French and in English. The `screen` skill says how to compare
them with the canvas.
