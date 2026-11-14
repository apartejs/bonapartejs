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

An error box is a window too. Electron shows a native one, in the foreground,
whenever it is launched on an app that is not built ("Unable to find Electron
app"), and whenever its main process fails to load. So:

- Never launch Electron before `pnpm build` has succeeded. The end-to-end
  fixture checks this itself (`e2e/fixtures/app-entry.ts`) and refuses to
  launch otherwise. Do not work around that check.
- Never run the end-to-end tests "to watch them fail" on an app that does not
  exist. A red end-to-end test comes from breaking the behaviour it checks, in
  an app that starts.
- With `BONAPARTE_E2E=1` the main process shows no error box: it writes the
  error to the console and exits with a code (`src/main/index.ts`). Keep that
  bootstrap free of any import but Electron's.
- Before the first Electron launch of a session, tell Paul what is about to
  run and wait for his go-ahead.
- If a window appears anyway: stop everything first (the `electron.exe` and
  the Playwright `node` processes of this project), explain afterwards.

## Prefer the end-to-end tests

They are the usual way to see a change: they launch the built app against the
fake llama-server, with `BONAPARTE_E2E=1`. The window of a test run is a real
one (a window that is never shown paints no frame, and every click then waits
for one), kept where nobody sees it: off the screen, transparent, out of the
taskbar, deaf to the mouse, shown without being activated. A test run also
leaves the graphics card alone. `e2e/shell.spec.ts` checks all of it.

```sh
pnpm --filter @aparte/bonaparte-app test:e2e                                  # builds first
pnpm build
pnpm --filter @aparte/bonaparte-app exec playwright test e2e/stream.spec.ts   # runs what was built
```

- Launch through the `launch` fixture of `e2e/fixtures/app.ts`, never
  otherwise: it refuses an app that is not built, gives the app a data folder
  of its own, and closes it, killing it if it does not leave.
- The first launch of a session runs one test, not the suite:
  `... exec playwright test e2e/shell.spec.ts -g "off the screen"`. Go on only
  when it is green.
- When a test fails, the fixture prints what the app wrote to its console
  (main process and window) and attaches a picture of the window. They are in
  `packages/app/test-results/`. Read them rather than guessing.
- After a run, check that no `electron` process of this project is left.
- A selector into aparté's chat goes in `e2e/fixtures/chat.ts`, nowhere else.
- A new end-to-end test must be seen red. Write it before the fix when the app
  can show the defect. Otherwise break the behaviour it checks, build, watch it
  fail for that reason, and put the code back. Never break the refusal of new
  windows outside a test run: the window would be a real one.
- After a navigation the app refused, Playwright still believes one is
  pending, and every `expect(locator)` waits for it: ask the page with
  `page.evaluate`, or read `launched.navigations()`.

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
them with the canvas. `e2e/screens.spec.ts` takes them when asked:

```sh
BONAPARTE_SCREENS=<folder> pnpm --filter @aparte/bonaparte-app exec playwright test e2e/screens.spec.ts
```

Look at each picture before showing it: the first ones had the line of the
empty conversation stuck to the left edge of the window.
