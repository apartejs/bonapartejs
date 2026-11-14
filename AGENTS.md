# AGENTS.md — bonaparte

Guidance for coding agents and contributors. `CLAUDE.md` imports this file
(`@AGENTS.md`); keep the two in sync by editing only this one.

## What bonaparte is

bonaparte is a **local-first coding agent** for the desktop: Electron, React,
apartéJS, and a llama.cpp server that the app manages. Three things set it
apart:

- **Each conversation keeps its memory.** The KV state of llama-server is saved
  and restored per conversation, so reopening a long conversation costs a
  fraction of a second instead of minutes of re-reading.
- **Every cost is announced before it is paid**: a model load, a re-read, an
  eviction, a restart, a download.
- **The memory serves the work**: going back before a message, or branching,
  reuses it.

The full design notes are private, in `docs/superpowers/` (git-ignored —
**never** remove that line from `.gitignore`; the repository is public).

## Status

Restarted from zero on 2026-11-13. The first implementation (v0) is archived on
the local branch `archive/v0`; it stays as lessons, and as code to port test by
test. The design came first (a private canvas, then a design document), and the
implementation follows a plan of fourteen phases, started on 2026-11-14.

Phase 0 is done: this file, the Claude Code configuration under `.claude/`, and
the project files. The application code starts with phase 1. A section below
that names something not built yet says so.

## apartéJS frictions — MANDATORY

bonaparte is also the proving ground of the apartéJS library (`@aparte/*`).
**Every friction met with the library is filed immediately**, the moment it
happens — never at the end of a session — as an issue on
https://github.com/apartejs/aparte/issues (in English: the repository is
public). Paul uses them to ship fixes and improvements to the library. The
`friction` skill is the procedure.

Counts as friction: a missing or awkward API, surprising behaviour, an
undocumented trap, documentation so absent you had to read the source, a
workaround you needed, a useless error message, an inconsistency between
packages. An issue gives the package and its version, what we were trying to
do, the friction, the workaround used in bonaparte, and the fix suggested on
the library side. A notable good surprise is pinned by a contract test in
bonaparte instead, so nobody breaks what works.

The library ships several releases a week. Before relying on it, and before
filing a friction, check the latest release and read its notes
(`npm view @aparte/core version`, `gh release list --repo apartejs/aparte`).
An issue can stay open after its fix has shipped.

## Invariants — never violate

- **Append-only prompt** (built-in engine). The frozen text of a `PromptLog` is
  never re-rendered between two rebases; a change of tools, project or project
  instructions is a delta appended to it. A rebase (compaction) is an explicit
  event, never a side effect. This is what protects the KV cache.
- **`/completion` only** for the built-in engine — never `/v1/chat/completions`.
  An external endpoint goes through aparté's own handler instead.
- **Strict restore.** A KV state is restored only when its manifest matches
  (model file, K/V cache types) and the context holds its tokens; on any doubt,
  re-read — announced.
- **The journal is the truth; a KV state is a cache.** Evicting a state never
  loses a message.
- **`packages/core` never imports `electron`** (enforced by lint).
- **The window never talks to llama-server or to a provider.** A turn goes
  through `bonaparte://agent` with aparté's stock runner; everything else goes
  through the typed IPC bridge.
- **One tool registry and one approval policy, in the core.** The window only
  runs interface tools (`ask_user`).
- **Nothing expensive without announcing it first**: a model load, a re-read, an
  eviction, a restart, a download.
- **Never a shell string, never a visible console.** Every child process goes
  through `spawnHidden` (argument array, `shell: false`, `windowsHide: true`).
- **A plugin never undoes its registrations by hand**; its context is torn down
  as one. A third-party view runs in a sandboxed frame, never with more rights
  than the conversation.

## How we work

- **Test first, always.** Red test, then the minimal implementation. The fake
  llama-server is the fixture for everything that touches the engine — no GPU
  in CI, ever.
- **Localise from the first string.** One file per language (`types.ts` +
  `fr.ts` + `en.ts`; a spec checks key parity). **Localisation is for the UI.
  Everything sent to the model is English** — system prompt, tool descriptions,
  results, tool error messages, permission refusals: it is a protocol, and
  models are trained on English instructions and tool-calling. The reply
  language is an explicit prompt instruction, driven by the locale.
- **English is the language of everything visible in the repository** — code,
  comments, commit messages, docs, plugin manifests, and the Claude Code
  configuration under `.claude/`. French is allowed only in the private notes:
  `docs/superpowers/`, and whatever stays untracked under `.claude/`.
- **Talk to Paul in French**: steps, command descriptions, summaries.
- **aparté for every control, no second UI library** (decided 2026-11-13).
  The chat, the composer, the approvals and the segment renderers, and also
  the app shell, the sidebar, the panes, tabs, menus, dialogs, fields and the
  diff view, come from aparté 1.7: its components and its kit of classes.
  bonaparte exists to prove that library, so what it lacks is added to aparté
  (an issue on apartejs/aparte), never worked around with another library.
  Semantic hook classes (`.conv-item`, `.setting-row`…) stay on elements,
  unstyled: the end-to-end tests and a host's rules read them.
- **React, latest stable, through `@aparte/react`** (decided 2026-11-14, when
  that was 19.3.1). The app reaches aparté through its React wrappers wherever
  one exists: bonaparte is the proving ground of `@aparte/react`, so a friction
  with a wrapper is an issue like any other. A plugin view is a custom element:
  built-in plugins are built with the app and share its React; a third-party
  plugin renders with whatever it brings, inside a sandboxed frame, and its
  Node half runs in its own process.
- **The palette is React's.** react.dev's tokens (accent `#087EA4`, their gray
  scale), declared on the `--aparte-*` masters for light and dark in one file;
  the kit derives inks and scales from them. Never write a colour anywhere
  else: read a token.
- **Professional UI finish from the first draft** — an unfinished screen is
  not shown. A screen is built from its board on the design canvas (the
  `screen` skill), compared with it, and validated by Paul on the real screen.
- **What the fake server cannot prove is replayed for real** — grammars, slots,
  the KV prefix under agentic load (the `smoke` skill). Record the result at
  the end of this file.
- **Local commits are free; NO push without Paul's validation in the app.** A
  guard hook refuses `git push`. The restart is built on the local branch `v1`,
  merged into `main` when Paul validates.

### Sub-agents and skills of the project

Sub-agents (`.claude/agents/`), all read-only. Use Sonnet by default, Haiku for
a trivial lookup, Opus only for a code review; one agent that does three things
rather than three agents.

| Agent | Model | Use it to |
|---|---|---|
| `scout` | haiku | find a file, a symbol, a usage |
| `aparte-docs` | sonnet | get an aparté API exactly, with where it was read |
| `canvas-reader` | sonnet | read a board of the design canvas |
| `v0-porter` | sonnet | read a module of `archive/v0` before porting it |
| `reviewer` | opus, high effort | review a phase at its gate |

Skills (`.claude/skills/`): `phase-gate` (the gate that ends a phase of the
plan), `screen` (build a screen from the canvas), `friction` (file an aparté
friction), `smoke` (the real-model suite), `run-app` (launch the app without a
console window).

## Security rules

The security audit of v0 found flaws the restart must not repeat. Each one is
a rule, and a test wherever one is possible.

1. **Electron**: the main window never navigates out of the app, and the
   preload serves only our pages; a strict CSP; every IPC handler checks its
   caller's origin and validates its arguments; the window never chooses an
   executable.
2. **Commands**: never a shell string. Every process is launched with an
   argument array, without `shell: true`, the name of an npm script included.
   "Always allow" remembers the exact command, not its first word, and refuses
   metacharacters (`&&`, `|`, `;`, a backtick, `$()`).
3. **Writing is sometimes executing**: files that run later (`.git/hooks`,
   `package.json`, `*.config.*`, `.husky`, `.env`) always ask, in every mode.
4. **Reading what leaves the machine is network**: `web_fetch` has the Network
   effect, not Read, and refuses local and private addresses unless a setting
   says otherwise.
5. **Prompt injection**: the control tokens of the model family's template are
   neutralised in tool results before they are rendered into the prompt.
6. **Perimeter**: without a project, the home folder — never the whole machine,
   never a network (UNC) path; symbolic links and junctions are resolved before
   the perimeter is checked; a deletion never accepts a relative path.
7. **Resource guards**: the code search runs outside the main process, can be
   cancelled, and has a time limit; the output of a tool or of a plugin is
   capped according to the context size.
8. **Plugins**: the host enforces declared effects; a plugin cannot declare
   Read and write.
9. **Modes**: the most permissive mode does not survive a restart without a
   new confirmation.
10. **Secrets**: API keys live in the system's vault and are never shown in
    clear; the terminal does not inherit secret environment variables.

## Commands

```sh
node --test ".claude/hooks/*.test.mjs"   # the guard hooks and the agent and skill definitions
```

The workspace commands (`pnpm dev`, `pnpm test`, `pnpm build`, `pnpm lint`,
`pnpm typecheck`, the end-to-end tests, the real-model smoke) arrive with
phase 1 and are listed here then.

## Landmarks

- **Private notes** (`docs/superpowers/`, absent from a public checkout): the
  design document `specs/2026-11-14-bonaparte-v1-refonte-design.md`; the plan
  `plans/2026-11-14-bonaparte-v1-plan.md` and where it stands,
  `plans/SUIVI.md`; the engine chapters (3 to 9 bis) of
  `specs/2026-08-19-bonaparte-consolidation.md`; a copy of the design canvas
  in `canvas/`.
- **Claude Code configuration** (`.claude/`, tracked): `settings.json`
  (permissions and hooks), `hooks/` (two guards and their tests), `agents/`,
  `skills/`. `guard-command` refuses a push, a skipped git hook, and a visible
  console window; `guard-gitignore` watches the private-notes line of
  `.gitignore`.
- **The four approval modes** keep aparté's French names in the product:
  Lecture (reads only, and plans), Répétition (asks before every change),
  Plume (edits pass, commands ask), Impro (asks only what is always asked).
- **aparté 1.7** (2026-11-14) is the version the restart is built on. It
  brought the keyboard of menus and tabs (`enhanceMenu`, `enhanceContextMenu`,
  `enhanceTabs`), the diff view with line comments (`@aparte/plugin-diff`),
  and steps and activities in the stream of a turn. Its loop runs the tool
  calls of one model step at the same time, and its agent handler cannot turn
  that off (apartejs/aparte#202).
- **`archive/v0`** is a local branch. Read it without leaving the current one:
  `git show archive/v0:<path>`, or the `v0-porter` agent. In Git Bash on
  Windows, prefix the command with `MSYS_NO_PATHCONV=1` when the path starts
  with a dot.
- Paul's machine has the **unified `llama` CLI**: the server is `llama serve`,
  with the same flags as llama-server.

## Lessons from v0

- **`/completion`, not the chat endpoint**: Qwen3's chat template is not
  byte-stable across turns (QwenLM/Qwen3#1826), which breaks the KV prefix.
- **Our own agent loop** for the built-in engine, not aparté's
  `runStreamAgent`: that engine owns the message list, which is incompatible
  with an append-only prompt. Every rule of the library that the loop depends
  on is pinned by a contract test.
- **Tool-call grammar**: `grammar_lazy` + `grammar_triggers` +
  `preserved_tokens` on `/completion` — undocumented in llama.cpp's README,
  verified in `tools/server/server-schema.cpp`. Without laziness the model
  would be forced to call a tool every turn. **The trigger hands its text to
  the grammar**: the root must consume the opening tag itself, or the server
  throws "Unexpected empty grammar stack after accepting piece". The root also
  admits several blocks; with one, parallel calls could not be emitted.
- **`prompt_progress` never rides the final event** of a completion: the cache
  gauge must read the intermediate events.
- **The KV manifest** checks only what llama.cpp cannot check itself: the model
  file and the K/V cache types. `n_ctx` only has to hold the saved tokens, and
  a change of llama.cpp build does not force a re-read.
- **The managed server** demands its per-launch key (`LLAMA_API_KEY` in the
  child's environment, `--no-webui`), listens on `127.0.0.1`, and `/props` is
  checked against the model that was launched.
- **A small model at its default temperature** is a coin flip on protocol
  details, and invents an answer unless the prompt names the tool. The smoke
  judges the harness: its prompts name the tool and its sampling is fixed.
- **node-pty loads under Electron without a rebuild.** It only needs to be
  allowed in `pnpm.onlyBuiltDependencies`: pnpm blocks build scripts by
  default, and without that the module installs with no binary. The terminal
  is a real terminal: xterm.js in the view, a PTY in Node, raw bytes in
  between — never re-filter the ANSI, the emulator interprets it.
- **Native Node halves live in a dedicated process** (`utilityProcess`). In
  v0, node-pty lived in the main process: a segfault would have taken the
  application, and the loaded model, down.
- **The plugin SDK pushes, with back-pressure** (`ctx.emit()` and
  `ctx.onDrain()`), the model taken from VS Code. `emit` returns `false` when
  the view is behind, and the producer must stop. Thresholds: pause at 100,000
  unacknowledged, resume under 5,000, acknowledge in packets of 5,000, per
  instance. The view acknowledges in `term.write`'s callback — when xterm has
  displayed, not when the IPC delivered — otherwise the producer restarts too
  early and output is lost.
- **The built-in web search worked without a key** (a hidden browser and a
  public engine); online providers stayed optional, their key in the vault.

## Real-model smoke results

Record here: the date, the model, the llama.cpp build, and the outcome of each
case. The newest entry comes first.

- **No run yet on the restarted code.** The first one is due at the gate of
  phase 2.
- **2026-09-26, v0 — 9/9 green.** Qwen3-1.7B Q4_K_M, llama.cpp
  b10217-ddd4ec142 (the unified `llama` CLI), Windows, `-c 8192`, K/V f16, one
  slot, temperature 0.2, seed 42. The cases: a real tool call, its execution,
  its result and the answer; the lazy grammar does not force a call; the KV
  prefix is kept after a tool round-trip (1,770 tokens served from the cache);
  save and restore with tool turns (960 tokens restored in 26 ms); a restored
  state serves as the prefix of a branch (602 of 602 tokens reused); prefix
  seeds (518 tokens, the whole system block); the managed server refuses a
  request without its per-launch key (HTTP 401); compaction is the rebase (the
  summary kept a secret read from a file); a real MCP server over stdio (the
  official filesystem server, 14 tools).
