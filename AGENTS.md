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
the project files. Phase 1 is done too: the workspace, the first modules of the
core (the llama.cpp client and its fake server, the Qwen template, the agent
handler) and the Electron shell with one chat. A first thread runs end to end:
the window posts a turn to `bonaparte://app/agent`, the core asks a llama.cpp
server — a fake one in the tests, a real one named by `BONAPARTE_LLAMA_URL` —
and the reply streams back; Stop cuts the generation on the engine. Phase 2
is done: the core owns the engine. It finds the models on the machine, says
what loading one costs (its time, its video memory — as llama.cpp counts it),
launches llama.cpp itself, hidden and with its per-launch key, and a turn
runs in the model's family: Gemma 4 by default, Qwen too. bonaparte keeps
its own llama.cpp build: it reads what is published, says the size first,
downloads on a click and verifies the digest. The window opens on « Préparons
le moteur » until a model is loaded. Phase 3 is done: each conversation keeps
its memory. A journal per conversation is the truth (one JSONL file per
branch, each entry with the text it froze into the prompt); the KV state of
the slot is saved when a conversation leaves it and restored when it comes
back, under a disk budget; a fresh conversation starts from a shared seed;
asking an answer again, or changing a message, makes a branch that starts
from the state its conversation saved. Opening a conversation says what it
costs before anything is paid: its memory saved (tokens, time, size), or let
go and to be read again — never in silence. The window lists the
conversations and keeps aparté's document of each beside its journal.
Phase 4 is done: the agent. One tool registry and one approval policy, in
the core: it reads, lists, searches, edits and writes files, runs a program
with its arguments, fetches a page and keeps a plan; the four modes decide
what passes, what is refused and what is asked, and a path that runs later
(`package.json`, a git hook, `.env`…) is asked in every mode but Lecture.
A call to ask pauses the turn with a signed ticket; the pause survives a
restart. The window shows what a call would change — its diff — before
« Autoriser », draws each call's line (« Lu notes.txt · 2 lignes »,
« Modifié » with its change behind it), switches the mode, presents a plan
in Lecture and asks the agent's questions in the composer's place.
Phase 5 is done: the shell. Projects are made from a folder (what it
holds said first) and reach their conversations — their folders, their
mode, their instructions. The sidebar lists them by project, then
« Discussions », each row saying where its memory is and whether it waits
for the person; Ctrl B, or a window under 1 100 px, folds it into named
icons. The header says the title, the project and the memory, with
« Plus d'actions » on aparté's keyboard. « / » and « @ » in the composer;
« Rechercher » (Ctrl K). The settings: Général, Apparence, Moteur et
mémoire, Modèles, Permissions, and a project's page. One app per data
folder; closing the window keeps it in the notification area; the last
conversation reopens; a conversation is deleted saying what goes, and the
conversations export as Markdown. A section below that names something not
built yet says so.

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
  in CI, ever. An end-to-end test is seen red in a built app: before the fix
  when the app can show the defect; otherwise by breaking, on purpose, the
  behaviour it checks, and putting it back. A test nobody saw fail has caught
  nothing yet: one of the first thirteen passed with the answer delivered in
  one block.
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
- **A test run never puts a window on the screen**, an error box included.
  Electron shows a native error box whenever it is launched on an app that is
  not built: never launch it before `pnpm build` has succeeded, and never run
  the end-to-end tests "to watch them fail" on an app that does not exist. The
  end-to-end fixture refuses to launch without a build, and in a test run the
  main process writes its errors to the console instead of showing them (the
  `run-app` skill has the details). The window of a test run is a real one,
  because a window that is never shown paints no frame: it is kept off the
  screen, transparent, out of the taskbar and never activated, and it leaves
  the graphics card alone. Ask Paul before the first Electron launch of a
  session.
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

Node 24 (`.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm lint                                      # ESLint: the module boundaries, no shell, no UI string in a component
pnpm typecheck                                 # every package, the end-to-end tests included
pnpm test                                      # unit tests (Vitest), against the fake llama-server
pnpm build                                     # every package; the app goes to packages/app/out
pnpm --filter @aparte/bonaparte-app test:e2e   # end-to-end (Playwright); it builds first
pnpm dev                                       # the app, with reload — this one opens a window
node --test ".claude/hooks/*.test.mjs"         # the guard hooks and the agent and skill definitions
```

One file at a time:

```sh
pnpm --filter @aparte/bonaparte-core exec vitest run src/agent/handler.spec.ts
pnpm --filter @aparte/bonaparte-app exec playwright test e2e/stream.spec.ts
```

- The end-to-end tests launch Electron: read the `run-app` skill before the
  first launch of a session. `test:e2e` builds first; `exec playwright test`
  does not, and runs whatever `packages/app/out` holds.
- `BONAPARTE_SCREENS=<folder>` makes `e2e/screens.spec.ts` take the pictures
  of the screens (light and dark, French and English) into that folder.
- `BONAPARTE_LLAMA_URL` points the app at a llama.cpp server that is already
  running; `BONAPARTE_DATA_DIR` keeps its data out of the real profile;
  `BONAPARTE_LOCALE` (`fr` or `en`) forces the language of the interface.
  `BONAPARTE_E2E=1` is set by the end-to-end fixture, and by nothing else.
- `BONAPARTE_LLAMA_BIN` names the llama.cpp binary to launch (a choice of
  the person: bonaparte then offers no build over it). Without it, the build
  bonaparte installed (`<data>/llama.cpp/`) comes first, then the PATH.
- `.github/workflows/ci.yml` runs all of the above, `pnpm dev` excepted, on
  Ubuntu and on Windows. A test run never asks GitHub: llama.cpp's releases
  are a local server of the test (`testing/fake-llama-releases.ts`).
- The real-model smoke (the `smoke` skill; never in CI), from
  `packages/core`:

  ```sh
  BONAPARTE_SMOKE_MODEL=<path to a .gguf> BONAPARTE_SMOKE_LLAMA=<llama-server> npx vitest run src/smoke
  ```

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
- **The packages**: `packages/shared` (contracts: modes, the IPC channels, the
  address of the agent), `packages/core` (Node only: the engine side, the
  agent handler, the fake llama-server under `src/testing/`), `packages/app`
  (Electron: `src/main`, `src/preload`, `src/renderer`, `e2e`).
- **End-to-end tests** (`packages/app/e2e/`): `fixtures/app.ts` is the only
  place that launches the app, and `fixtures/chat.ts` holds every selector
  into aparté's chat, which documents none: a release that moves one breaks
  that file, not twenty specs.
- **The window is one page**, and it never loads another document. A link in
  a reply is refused twice: by the page, whose `<AparteChat onLinkClick>`
  prevents it (aparté 1.9), and by the main process, which refuses every
  address but the window's own (`isOwnPage`).
  Opening a file in its pane and a site in the system browser arrive with the
  panes and with the list of allowed addresses.
- **The four approval modes** keep aparté's French names in the product:
  Lecture (reads only, and plans), Répétition (asks before every change),
  Plume (edits pass, commands ask), Impro (asks only what is always asked).
- **aparté 1.7** (2026-11-14) is the version the restart is built on. It
  brought the keyboard of menus and tabs (`enhanceMenu`, `enhanceContextMenu`,
  `enhanceTabs`), the diff view with line comments (`@aparte/plugin-diff`),
  and steps and activities in the stream of a turn. **aparté 1.8** (the same
  day) keeps the tool calls of one step in order unless a tool says
  `parallel: true`, holds the calls after one awaiting approval, and gives
  `createAparteAgentHandler` its `parallelTools` option: apartejs/aparte#202
  is fixed. **aparté 1.9** (2026-11-15) gives the runner the conversation of
  each turn (`endpoint: ({ conversationId }) => …`), labels for step keys
  (`registerStepLabel`), `<AparteConversationList manage>` and
  `<AparteChat onLinkClick>`. **aparté 1.10** (2026-11-15) gives each chat
  its own conversation on one manager (`getConversationId()`, the guide
  « Several live chats »), the turn to `approvalResolver`
  (`{ conversationId, messageId, targetId }`), a stable history after a
  failed turn, `renderMeta` on the list's rows, React components for the
  plugins' elements (`createAparteElement`), `.aparte-segmented` and the
  kit's hover tooltip. bonaparte runs on 1.10.0. One trap is open
  (apartejs/aparte#236): a chat mounted with `conversationId` draws nothing
  of it until `setConversationId(id)` is called on its handle — the deck
  does it as each chat mounts.
- **The deck of live chats** (`renderer/src/chat/deck.ts`, `ChatDeck.tsx`):
  one `<AparteChat>` and one client per live conversation — the one shown,
  those that work or wait for the person, the four seen last — each bound to
  its conversation for its whole life; the conversation open is the shown
  chat's, never the manager's `activeId`. The list's `target` is the deck
  (`bonaparte-chats`), so it opens nothing itself: every opening goes through
  `goTo(id)`. What only the person acts on (the approval card, the toolbar)
  is given to the chat shown; the composer helpers aim at the shown chat
  unless one is named, and the end-to-end fixture reads the shown chat.
  After a restart, the conversations that wait are mounted hidden, so their
  pause is asked again.
- **The agent** (`packages/core/src/agent/`, `tools/`, `permissions/`,
  `project/`): `runAgentTurn` runs the tool rounds inside the conversation
  engine's turn, in the slot it holds; the registry passes writes and
  commands one at a time per conversation, in their order, and caps a tool's
  output to the context. A call to ask ends the stream with `run-suspended`
  and its ticket (HMAC-SHA256, the installation's secret in
  `<data>/engine/ticket.key`, seven days); the journal keeps the pause, and a
  resume runs or refuses the calls as answered. What the model reads of the
  mode, and of the window's tools (`ask_user`), is a note appended at the
  start of a turn when it changed — never the frozen prompt, so one seed
  serves every mode. A tool's `structuredContent` is for the window only
  (lines read, matches, exit code, the unified diff of a write): the families
  never render it.
- **Approvals in the window** (`renderer/src/aparte/approvals.ts`,
  `chat/ApprovalCard.tsx`, `chat/ModeSwitch.tsx`): the client's
  `approvalResolver` owns every decision — aparté's page policy is never
  consulted — and the card is bonaparte's, with `<aparte-diff>` fed by the
  core's preview (aparté's panel has no slot for it, apartejs/aparte#214).
  The switch is aparté's `<aparte-approval-mode>`, enabled by `setupApproval`
  (no React wrapper, apartejs/aparte#216). The mode chosen before a
  conversation's first message travels with that turn (`?mode=`): the page
  saves a new conversation before its first turn reaches the core, so a read
  of the core then answers the default. A call paused before a reload is
  asked again as its conversation loads, before React knows which one is
  open: a capturing listener files it under the conversation aparté loaded
  (apartejs/aparte#221).
- **The thread of a working agent**: the tools' lines (`aparte/tool-lines.ts`,
  one line provider, apartejs/aparte#219; the target in the code font,
  apartejs/aparte#220), the plan card (`aparte/plan-card.ts`: aparté's card
  for the steps, wrapped to draw the files, the questions and « Lancer en
  Plume » under it, apartejs/aparte#222), and the question (`ask_user`,
  aparté's own, without keys yet, apartejs/aparte#223). aparté's French says
  « vous »: the words bonaparte shows are said with « tu »
  (`aparte/words.ts`).
- **A relaunched server is a new one**: the supervisor counts the servers
  that became ready (`generation`), and the conversation engine forgets every
  resident of a server that went away — never saved over the memory on disk.
  A state the budget lets go leaves a note (`<id>.evicted.json`: when, which
  budget) that its re-read announcement reads; a state older than the
  journal is restored and the rest read, announced as `behind`.
- **The memory** (`packages/core/src/journal/`, `kv/`, `engine/slot-scheduler.ts`,
  `conversation/`): `ConversationEngine` owns the slot scheduler; a turn
  takes the slot, whose restore hook brings the conversation's KV state, else
  the seed (its first system turn, prepared once by a prefill and shared),
  and says what it waits for as steps (`slot-wait`, `restore`, `seed`,
  `reread`) that the window labels. The handler compares the window's
  messages with the journal (`agent/divergence.ts`): a new message, an
  answer asked again or a changed message (both branch), or a 409. The KV
  states live under `<data>/kv-slots/`, the conversations under
  `<data>/conversations/<id>/` (`meta.json`, one `<branch>.jsonl` per branch,
  `branches.json`, aparté's `aparte.json`).
- **The shell** (`renderer/src/shell/`): `.aparte-app-shell` holds the
  sidebar (`Sidebar.tsx`) or its rail (`Rail.tsx`), the header
  (`ConversationHeader.tsx`) and the chat. A project is a header of ours
  above a `flat` aparté list of its conversations (aparté groups by date
  only, apartejs/aparte#229). What each row shows comes from
  `conversations.status` (project, memory, waiting), asked again when
  something may have changed it — the bridge pushes nothing
  (`shell/statuses.ts`); the memory dot is a stylesheet regenerated on the
  rows' `data-conv-id`, its name CSS alt text read after the title. aparté's
  list draws itself again for any new array, closing an open row menu: give
  it the same array while nothing it draws changed. Menus and tabs get
  aparté's keyboard through `aparte/kit.ts` (`useMenu`, which must be told
  when its elements arrive).
- **The settings** (`renderer/src/settings/`): over the shell, which stays
  mounted and hidden (a reply goes on). The app's settings live in the
  core's `SettingsStore` (`config/global.json`, under `settings`), checked
  against `APP_SETTINGS`; a change is said on the window
  (`bonaparte-setting`), the look is applied to the root
  (`theme/appearance.ts`), the language by asking the main process again
  (`bonaparte-locale`) — an open conversation hears it as a note at its next
  message. The permission engine reads `askBeforeNetwork` and `alwaysAsk`
  (global, and a project's own list).
- **One app per data folder** (`main/startup.ts`): the window's profile is
  `<data>/window`, and Electron's single-instance lock with it — a test run
  never meets the person's app. A test run puts no icon in the notification
  area (it gets `globalThis.__bonaparteTray`), never writes « launch at
  login », and opens no folder (`__openedDataFolder`).
- **Model families** (`packages/core/src/families/`): one layer per family —
  turns, control tokens, stop strings, the tool convention, the lazy tool
  grammar, the stream demux. **Gemma 4** is the default of the product,
  rendered byte for byte as Google's template (`__fixtures__/gemma.jinja`,
  checked with `@huggingface/jinja`); Qwen is the second. Reasoning is
  switched on once, in the frozen system turn; a turn without it opens with
  the empty thought channel.
- **The engine** (`packages/core/src/api.ts`, `engine/`): `createCore` owns
  the supervisor; asking about the engine runs nothing, a load is the only
  thing that launches llama.cpp. The card's memory is what llama.cpp lists
  (`--list-devices`), the registry only after it.
- **llama.cpp kept by bonaparte** (`engine/llama-release.ts`,
  `models/download.ts`, `engine/llama-install.ts`): the Vulkan package on
  Windows and Linux, Metal on a Mac; a package without GitHub's SHA-256
  digest, or from anywhere but llama.cpp's releases, is never offered;
  unpacked by the system's `tar` (Windows' own, by its full path).
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

## Lessons from the restart

- **Stop crosses `protocol.handle`** (Electron 45). When the page aborts its
  request, the handler's signal fires and the engine is cut within a second:
  no IPC channel is needed for Stop. Pinned by `e2e/stop.spec.ts`.
- **A failure of llama-server once the stream has begun is an event of the
  stream** (`data: {"error": …}`), not a status. Read past it, and the reply
  looks like one the person stopped.
- **aparté reveals a text gradually, whatever its arrival.** Watching a reply
  grow in the page proves nothing about streaming; an end-to-end test reads
  instead that the engine has not finished (`server.finished`) while the first
  words are shown.
- **After a navigation the app refused, Playwright believes one is pending**:
  it never hears of the refusal, and every later `expect(locator)` waits for
  it. Ask the page with `evaluate`, or keep the browser from trying.
- **`will-navigate` is not raised for `about:blank`.** Only a script of the
  page can go there; no link of a reply can (aparté drops the scheme).
- **A relative link in a reply is a navigation.** aparté keeps
  `[package.json](package.json)` as it is; in a window that is one page, that
  click replaced the conversation.
- **The colour guard reads comments too**: write an issue as `owner/repo#123`,
  never as a bare `#123`.
- **On Windows a child process dies with the app** that launched it without
  `detached` (libuv puts it in a job object): there, an engine cannot outlive
  bonaparte whatever it does. Elsewhere the server runs detached, as a group,
  and quitting must stop it (`main/quit.ts`). And Playwright's own `close()`
  kills the whole tree on Windows: a test of quitting calls `app.quit()`.
- **A unified-memory machine is more than its carve-out.** On an APU the
  registry declares the firmware's share (8 GiB on a Radeon 8060S) while
  llama.cpp can use the shared memory (79,992 MiB there). Ask the engine.
- **llama.cpp colours its log even into a pipe**: the lines kept for an error
  message lose their ANSI escapes (never those of the terminal pane, which
  an emulator reads).
- **A model file can be unreadable by the official llama.cpp** while LM
  Studio runs it: the Gemma 4 GGUFs it stores with a `-gu` suffix lack
  `blk.N.ffn_gate.weight`, for b10217 and b12383 alike. The load fails with
  llama.cpp's own lines on the screen; the inventory cannot tell beforehand.
- **A test of « nothing happens before the click » reads the state**, not
  only a port: a load that has just begun answers on no port yet, but says
  `starting` at once. For the managed engine, the fake binary writes every
  completion it is asked into `FAKE_LLAMA_REQUESTS` (the fixture's
  `engineRequests()`), with the tokens it counted: that is how a test proves
  nothing was read, and what the gauge must show.
- **llama.cpp reads again the last few tokens of a cached prefix** on a model
  with sliding-window attention (Gemma 4): it resumes from its last context
  checkpoint, which it places a few tokens before the end of each prompt —
  5 on b12383, a fixed cost. A restore or a seed serves all its tokens but
  those; the smoke allows for it (`CHECKPOINT_TAIL`).
- **A flex item takes the width of its widest unbreakable content** unless it
  says `min-width: 0`: the first long message, as a conversation's title, made
  the sidebar 16,000 px wide and the send button unreachable.
- **aparté hides the waiting step once an activity shows**: during a re-read
  the screen shows our bar, and the step stays in aparté's live region — what
  an end-to-end test reads.
- **The page saves a conversation before its first turn reaches the core.**
  Whatever the page chose before the first message (the mode) has to travel
  with that turn; a read of the core in between answers the default, and a
  window that trusts it shows a mode the conversation does not run in.
- **A small model plans only when the tool is named**: Lecture's note and
  its refusals say `update_plan`, not « a plan ».
- **A test that reads aparté's question** finds it in the composer
  (`aparte-composer [data-aparte-panel]`), not in `<aparte-elicitation>`;
  its choices are buttons, not radios.
- **aparté's select holds every option in its own text** (a hidden sizer
  that keeps its width): `toContainText` on the mode switch is true
  whatever the mode. Read its label (`chat(page).modeShown`).
- **The app bundles the core.** An end-to-end test runs what
  `packages/app/out` holds: a change of the core needs the core built,
  then the app (`pnpm build`, or `test:e2e`, which builds). A test « seen
  red » by breaking the core without rebuilding the app proves nothing.
- **The kit gives `.aparte-sidebar`'s children its full width** (for its
  fold): a sidebar with margins overflows unless its children get
  `min-width: 0`. And `display: grid` on `.aparte-app-shell` beats the
  `hidden` attribute: hide it with a rule of ours.
- **`<AparteUi props>` is compared by identity, and `aparte-triggers`
  closes its list whenever `triggers` is set again** (apartejs/aparte#232):
  an inline props object closes « @ » under the person's fingers. Memoize
  it.
- **A radio hidden by a screen-reader-only class is not clickable** for a
  test (nor by any tool that targets it): draw it transparent over its
  label instead.
- **A test that relaunches on the same data folder** must keep what the app
  wrote there: the fixture merges the settings it finds.

## Real-model smoke results

Record here: the date, the model, the llama.cpp build, and the outcome of each
case. The newest entry comes first.

- **2026-11-15, phase 5 — 12/12 green.** Same model and build (Gemma 4
  26B-A4B-it UD-Q4_K_XL, llama.cpp b12383 Vulkan, Radeon 8060S, `-c 8192`,
  K/V f16, one slot), loaded in 14 s, after checking the free memory of
  Windows (67.1 GiB, for 16.7 GiB announced). The ten cases of phase 4 again
  (restore of 1,252 tokens in 1.8 s, all served by the cache; branch 1,276 of
  1,284; seed 1,171 of 1,171; the agent's last round 1,275 of 1,298; Stop
  63 ms), and two of phase 5: the reply language changed mid-conversation is
  a note at the next message — the model answers « sept », then
  « fourteen », 1,256 of the 1,306 tokens served by the cache (the frozen
  prompt untouched); and the memory survives « Décharger » and
  « Redémarrer » — unloaded, reloaded, the conversation is restored in
  571 ms and still knows its code word; restarted in 10.1 s, restored in
  1,045 ms.
- **2026-11-15, phase 4 — 10/10 green.** Same model and build (Gemma 4
  26B-A4B-it UD-Q4_K_XL, llama.cpp b12383 Vulkan, Radeon 8060S, `-c 8192`),
  loaded in 20 s, after checking the free memory of Windows (32.7 GiB, for
  16.7 GiB announced). The eight cases of phase 3 again, with the system
  prompt of phase 4 (its tools: 1,171 tokens of seed, against 76), and two
  of the agent, through aparté's stock runner and bonaparte's handler as
  the window's turns go: the model calls `read_file` on a file of the
  smoke's home folder and answers the code word it holds, the last round
  served by the cache but for the tool's result (1,275 of 1,298 tokens);
  an `edit_file` in Répétition ends the stream with `run-suspended`,
  nothing written, and the person's answer resumes the turn — approved,
  resolved, the file written, « DONE ». Stop cut a real generation in
  117 ms. Two findings: a restore of 1,252 tokens took 2.7 to 3.3 s (91 ms
  for 157 tokens in phase 3: the cost of a restore grows faster than its
  tokens — to measure with the restore-speed item of the ledger); and asked
  to count to 500, a real model with its tools may run a counter instead
  of writing: the Stop case now asks for text.
- **2026-11-15, phase 3 — 8/8 green.** Same model and build as phase 2
  (Gemma 4 26B-A4B-it UD-Q4_K_XL, llama.cpp b12383 Vulkan, Radeon 8060S,
  `-c 8192`), loaded in 11 s, after checking the free memory (75,992 MiB on
  the card, 54.6 GiB of RAM). The five cases of phase 2 again, with the
  system prompt the app builds, and three of the memory, through the
  conversation engine and the handler as the app's turns go: a conversation
  that leaves the slot is saved and comes back restored in 91 ms, 151 of its
  157 tokens served by the cache, and the model still gives the code word it
  was told; an answer asked again starts from the state its conversation
  saved (181 of 189 tokens), not from what the slot held; the seed one fresh
  conversation prepared serves the next one (71 of its 76 tokens; served
  2 → 3). The tokens read again are llama.cpp's checkpoint tail (5),
  measured against `/tokenize`: the token sequences are identical. Replayed
  after the gate's fixes: 8/8 (restore 112 ms).
- **2026-11-14, phase 2 — 5/5 green.** Gemma 4 26B-A4B-it UD-Q4_K_XL
  (unsloth), llama.cpp b12383 (`llama-server`, the Vulkan package bonaparte
  downloads and verifies), Windows, Radeon 8060S (unified memory: llama.cpp
  lists 79,992 MiB), `-c 8192`, K/V f16, one slot, temperature 0.2, seed 42,
  loaded in 13 s (37 s cold). Everything through `createCore`, as the app
  does. The cases: the server refuses a request without the per-launch key
  (HTTP 401); the rendering is the GGUF's own template byte for byte with
  reasoning on (`/apply-template`), and a turn without reasoning opens as the
  template opens one; the lazy tool grammar forces no call on a plain
  question (answer « 4 »); a real model writes a Gemma call that the demux
  reads (`read_file {path: notes.txt}`); Stop cuts a real generation — the
  slot stopped 62 ms after it. Not loadable by official llama.cpp (b10217 nor
  b12383): the Gemma 4 GGUFs that LM Studio stores with a `-gu` suffix
  (`tensor 'blk.0.ffn_gate.weight' not found`).
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
