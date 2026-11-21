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
conversations export as Markdown. Several chats live at once: a reply goes
on while the person looks at another conversation (the deck, 5.5).
Phase 6 is done: the panes and the work on the code. Beside the
conversation, Fichiers (the perimeter's tree, a read-only preview, « P » and
« M »), Changements (what waits and what was applied, aparté's diff,
« Revenir » on one file, comments on the lines sent as one message) and the
terminal (a real shell per tab in a process of its own, the agent's
commands in their tab). A conversation of a git project may work on its own
branch: a worktree made at its first change, its row and its header saying
it; its pull request and CI through GitHub's CLI; archived with what is not
committed asked first. The core hosts plugins: one context torn down as
one, a tool holding only what its effect allows, the terminal the first
built-in one. Phase 7 is done: going back, branches, compaction and the
costs said before they are paid. A message of the person's offers
« Revenir avant » (the code and the conversation, the conversation only,
or the code only: what moves is said first, the commands already run
named, « Annuler le retour » until the next turn) and « Brancher » (every
branch kept, the one shown followed). A compaction is a rebase: the
summary (facts quoted, then the work), the turns kept when they weigh
little, « Restaurer », « / compact », the context nearly full said from
90 %. The six announcements of the board are on the screen: a restore, a
re-read (« Compacter d'abord »), a change of model (aparté's model
selector, « Passer à … ? » with « Changer » and « Brancher sur ce
modèle »), the context nearly full, the engine unloaded (« Charger et
envoyer », a send held meanwhile) and a launch setting that restarts the
engine (« À la fin de la réponse » or « Maintenant »). Phase 8 is done:
sub-agents, « À traiter » and the notifications. The model hands an
independent lead to a sub-agent (`run_subagent`): a thread of its own, the
tools it is given (read, or all but itself and the window's), never more
than its conversation's mode; the turn lends it its slot — the
conversation's memory saved, then restored — and its pause is answered like
the conversation's, across a restart. « En parallèle » runs two on two
slots, the second slot's cost said before the engine restarts. Its line in
the thread, the « Sous-agents » pane, the engine card « Occupé : sous-agent
… », an approval that names who asks. Ctrl J opens « À traiter »: what waits
across the conversations — an approval answered from there, a question
opened on its conversation, a CI that fails, a turn the engine cut read
again with its cost said — and the replies not read yet (a blue dot on
their row). When the window is not in front: a banner by the person's
setting for each event (a reply done, an approval, a question, a failure),
never an approval given from it; the icon of the notification area in four
colours, its menu (what waits, the engine, « Libérer le modèle », « Ne pas
déranger pendant 1 h », « Quitter ») and the taskbar's badge.
Phase 9 is done but for its task 9.4 (Llama, Mistral and gpt-oss, put off
by Paul): the services and the first launch. A service the person already
has — Ollama, LM Studio, a llama-server already running, an
OpenAI-compatible API — is probed, added (its key in the system's vault),
and a conversation runs there in aparté's own loop with the core's tools and
approval policy; a conversation goes to a service between two turns, what it
loses said first, and comes back to the built-in engine read again for its
model; a service that stops answering is said, the message kept. A
conversation without a project is a discussion, as in the market's chats:
no file reached, nothing run, the web only; « Travailler dans un projet… »
makes it a code conversation, nothing read again. The first launch offers
the built-in engine — llama.cpp, the card, the models found, the models
recommended for the card (Google's Gemma 4 and Qwen's Qwen 3, downloaded on a
click and verified), the context and its gauge — or a service, tested then
connected. `bonaparte doctor` says what the machine has for the built-in
engine. Phase 10 is done, its MCP smoke green on a real model: the browser, the
web search and MCP. A pane « Navigateur » shows pages in native views of
the main process — tabs, the address, « Ordinateur » or « Téléphone » —
and the agent opens, reads, screenshots and acts on the tab the person
sees, judged like every tool. The person shows an element of the page
(« Sélectionner un élément ») and joins it to the message as a pill, pins
numbered comments that leave together (« Commenter la page »), and joins
the console's errors. The new tab lists what the project runs (its
package.json's servers, its compose services), launched on a click,
hidden, their page opened once it answers. `web_search` searches a public
engine in a hidden page, or an online provider whose key stays in the
vault, asked before it goes out. MCP servers (stdio, launched hidden
without a shell, their tree stopped; or HTTP) are kept for the app or a
project in « Serveurs MCP », started by the first turn, their tools in the
one registry. Phase 11 is done: the plugins. A plugin is added from a
folder, npm (its version fixed) or git, read before anything of it runs —
its manifest, « auteur non vérifié », its effects, what it will add — then
kept under `<data>/plugins/<id>/`, switched on or off, an update offered,
never made in silence. Its Node half runs in a process of its own and
speaks by messages; its tools are `plugin__<id>__<tool>`, judged like
every tool; its view runs in a sandboxed frame of its own origin
(`bonaparte-plugin://<id>/`), with the kit's sheet and the theme, and
never the bridge. « Réglages · Plugins » lists those made in a
conversation, those added and the built-in ones — « Sous-agents »,
« Titres automatiques » and the project's scripts among them, each
switching the core's own function — and a project may switch off what
the app switches on. The agent makes a plugin in a conversation
(`harness_inspect`, `extension_define`, compiled and never run): its
card says what it adds and what it may do, « Essayer dans cette
conversation » runs it there alone, its « / » command marked « À
l'essai », and « Installer » keeps it with the others. A section below
that names something not built yet says so.
Phase 12 is done: the finishing. The shortcuts are one registry, each
changed in « Réglages · Raccourcis » (captured, a conflict said, kept
across a restart); the mascot in its bicorne lives in the sidebar's head,
its state read from the turn's events; the app's icon is drawn from the
same tokens. When something breaks a card says when, what, what is safe
and what is lost, and what can be done: a model too big for the card (a
part on the processor, said slower, or a smaller one), llama.cpp missing
(downloaded, a file chosen, or a service), the engine dead in a reply (its
log, « Relancer et relire »), a service that stops answering, a memory
saved by another model, the disk nearly full — never « erreur inconnue ».
A conversation has its own temperature, reasoning and context cap
(« Réglages de la conversation… »), and the engine's card shows the
processor, the memory and the graphics card. Every button has a name, and
the shell's Tab order is written in a test.
Phase 13 is done but for its real-model smoke (task 13.5, on Paul's word):
the distribution. « Mises à jour » says what each update costs before it is
done — the app (electron-updater, its download first, the end of the reply
waited for, the memory saved before the installer starts), llama.cpp (the
same model loaded again, on the old build if the new one fails) and a
model's new version (the conversations it makes to read again) — and
nothing installs under a reply. A per-user NSIS installer updates itself
from the repository's releases, a tag making one draft; the packed app is
run by a test before it is published. `npx @aparte/bonaparte` launches the
app it carries. The security audit of the whole repository (the ten rules,
`docs/superpowers/plans/securite.md`) found 23 defects, all fixed or ruled
on; every package is at 1.0.0, and the tag `v1.0.0` waits for Paul.

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
  One named exception: `spawnWindowed`, for a program that shows a window of
  its own (the app, launched by `npx @aparte/bonaparte`) — still an argument
  array and no shell, a script refused, but not hidden: Windows would hide the
  first window it shows.
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
node packages/cli/dist/cli.js doctor           # what the machine has for the built-in engine (after pnpm build)
pnpm --filter @aparte/bonaparte-app dist:dir   # the app packed by electron-builder, unpacked (after pnpm build)
pnpm --filter @aparte/bonaparte-app dist       # the per-user installer (NSIS on Windows)
pnpm --filter @aparte/bonaparte pack           # the npm package, the built app assembled inside
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
- `node scripts/make-icons.mjs` (from `packages/app`) draws the icons of the
  notification area and of the taskbar's badge again, after a change of a
  `--bonaparte-tray-*` token; `src/main/icons/draw.spec.ts` fails until it
  has run.
- `.github/workflows/ci.yml` runs all of the above, `pnpm dev` excepted, on
  Ubuntu and on Windows. A test run never asks GitHub: llama.cpp's releases
  are a local server of the test (`testing/fake-llama-releases.ts`).
- The real-model smoke (the `smoke` skill; never in CI), from
  `packages/core`:

  ```sh
  BONAPARTE_SMOKE_MODEL=<path to a .gguf> BONAPARTE_SMOKE_LLAMA=<llama-server> npx vitest run src/smoke
  ```

  `BONAPARTE_SMOKE_MODEL2` names a model of another family: the change of
  model (task 7.4), skipped without it. In the end-to-end tests the fake
  engine answers `FAKE_LLAMA_ANSWER` instead of « ok » (with
  `FAKE_LLAMA_PACE_MS`, a reply that lasts).

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
  (Electron: `src/main`, `src/preload`, `src/renderer`, `e2e`),
  `packages/cli` (`@aparte/bonaparte`: `bonaparte doctor`, its words in
  French and English; launching the app from it is task 13.3).
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
  kit's hover tooltip. **aparté 1.10.1** (2026-11-15) types the mode
  switch's event (`ApprovalModeChangeDetail`) and the list's selection
  (`AparteConversationSelectDetail`, `id` null for a new conversation), and
  a chat mounted with `conversationId` draws it at once. **aparté 1.11.0**
  (2026-11-16) lets a registered bubble action show its words
  (`display: 'label' | 'both'`) and stand before the built-in buttons
  (`position: 'start'`), names what a history opens with after a
  checkpoint (`_meta.historySummary`), and spaces the diff's line numbers:
  apartejs/aparte#240, #241 and #243 are fixed. **aparté 1.12.0**
  (2026-11-16) fixes #244 to #251, and bonaparte runs on it: the model
  picker is `createModelCatalogue`, a pick says `picked`; a send held while
  the engine is unloaded is `aparte-before-send` cancelled; a compaction
  that keeps no turn covers its own message (`contextSummary.includesSelf`)
  and tells the gauge (`aparte-compact-done`); a message written while a
  reply runs waits above the field (`setQueueWhileStreaming`); Stop says
  « Arrêter les sous-agents » while they work (the composer's `stopLabel`);
  « À traiter » answers a question with choices (`observeElicitations`).
  Not adopted: the sub-agents' line on the turn's fold (`setTurnSummary`,
  #247), which folds the tool lines of every reply: Paul keeps the lines as
  they are (2026-11-18).
  **aparté 1.12.1** keeps `<aparte-diff>` as it is when handed the same
  comments or the same change (apartejs/aparte#253: `DiffView` hands them
  as they come), and **1.12.2** says `picked` for a model chosen through
  `/model` (apartejs/aparte#255). **aparté 1.13.0** (2026-11-17) gives a
  message its author, a notice (`kind: 'notice'`), a note under a message
  and `setAutoReply`; bonaparte runs on it and uses none of them yet.
  **aparté 1.13.1** (2026-11-18) only wraps long notices. **aparté 1.14.0**
  (2026-11-19): a pill goes in at the caret or after the draft
  (`insertToken` past the end, apartejs/aparte#259), a « / » command
  carries a `badge` (#261), the composer's `stopKey` (#264), and the error
  renderer's `appCode` (#265). **aparté 1.15.0** (2026-11-19): an error
  renderer returns `null` for an error it does not change, and that error
  keeps aparté's own card (#267). **aparté 1.15.1** (2026-11-20), which
  bonaparte runs on: a failed call in a sub-agent's transcript no longer
  reads in the success colour (#271, pinned by `e2e/subagents.spec.ts`), a
  reasoning that comes after its block closed opens a new one (#272), and a
  scrolled thread no longer moves a pixel each way while reasoning streams
  under React (#270). **aparté 1.16.0** (2026-11-20), which bonaparte runs
  on: a conversation moves to another group (`moveTargets`,
  `onConversationMove`, apartejs/aparte#269); the parser hands its text over
  at a `turn-start` and the run's end (#275; the core still flushes); the
  model picker lists a catalogue replaced under the same id (#276, its
  workaround gone). Open: apartejs/aparte#278 (a row dragged onto another
  list) and #279 (a toast).
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
  serves every mode; a compaction in the middle of a turn tells both again
  after its summary (the rebase's `mode`, `windowTools`). A tool's `structuredContent` is for the window only
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
  `reread`) that the window labels. A wait for the slot names who holds it
  and what it does (`holder`: a title or a sub-agent, answering, a tool and
  its target, compacting — audit C1), said again as it changes; the
  window's runner keeps it before aparté draws the step, which has no field
  for it (`aparte/engine-wait.ts`, apartejs/aparte#288), and the row of a
  conversation that waits wears an hourglass (apartejs/aparte#289). The
  engine card's « Occupé : … » reads the same holders (`EngineState.working`).
  A call the person approved runs before its turn takes the slot again: it
  holds nobody up. « Slots du moteur : 1 · 2 » (« Moteur et mémoire », the
  key `subagentsOnBuiltin`) serves two conversations as well as two
  sub-agents (audit C2); with no context chosen it takes the one a load
  chooses for two, the drop said and the memories past it counted
  (`restartCost`'s `parallel.nCtxBefore`, `vramBytesMore`). The handler compares the window's
  messages with the journal (`agent/divergence.ts`): a new message, an
  answer asked again or a changed message (both branch), or a 409. The KV
  states live under `<data>/kv-slots/`, the conversations under
  `<data>/conversations/<id>/` (`meta.json`, one `<branch>.jsonl` per branch,
  `branches.json`, aparté's `aparte.json`).
- **Going back and branches** (`core/src/conversation/rewind.ts`,
  `branches.ts`, `kv/reread.ts`; `renderer/src/chat/useRewind.ts`): going
  back is a new journal branch before the message (a `rewind` entry, the old
  branch kept with its memory); the files go back by undoing the checkpoint
  turns written since, the commands run named. What its memory costs follows
  llama.cpp's checkpoint rules (`rereadBeforeMessage`). The window takes a
  chat down before the core moves its branch, and mounts it again on what
  the core shows: a chat writes its thread back as it leaves.
- **Compaction** (`core/src/conversation/compact.ts`,
  `renderer/src/chat/useCompaction.ts`): a `rebase` entry — the system prompt
  frozen again, the summary as a note, the last two turns as they were frozen
  when they weigh at most a third. aparté's checkpoint (`contextSummary`)
  sits where the core's rebase begins; after it aparté sends the summary as
  the first user message and names it (`_meta.historySummary`), which the
  divergence takes off as it is (apartejs/aparte#243). With no turn kept,
  the checkpoint sits on the last answer and covers it (`includesSelf`,
  aparté 1.12); the window then dispatches `aparte-compact-done` so that
  the gauge measures again — aparté's own compaction says it, the core's
  does not. A fork among the kept turns
  keeps the compaction (a rebase frozen again, the kept turns cut and copied
  after it); a fork before a compaction or a change of model never carries
  the parent's memory. When the context runs out the core compacts on its
  own (audit 2026-11-21, D2): before a message that would not leave
  `REPLY_ROOM` — its notes measured first —, between two tool rounds
  whose results would not, and as a turn resumes on what the person's
  answers brought in (an approved command's output) — then the turn under way is kept as it was
  frozen (`planCompactionKeeping`), or, when what precedes it is not worth
  folding (a fresh conversation, a rebase earlier in the turn) or it
  weighs too much, folded on itself (`planTurnFold`, the rebase's
  `keptRound`): its message and its last round kept, its earlier rounds
  in the summary (« Work so far in this turn »), folded again as often as
  it overflows (what an earlier rebase of the turn kept is what is folded
  then; a last round holds a pause and its answers too). It goes on in the slot
  it holds; a last round that alone overflows ends as context-full. It is
  a rebase like any other, said as it runs (the step `compact`) and as a
  line of the answer that stays (the activity `compaction`,
  `aparte/compaction-line.ts`: about how many tokens before and after —
  the engine's count before, the rebase scaled as it counted); the window sets no checkpoint, the divergence reads the
  whole history. A conversation too full for a summary of the whole has
  its last turn kept and the summary asked of what comes before it.
- **A change of model** (`core/src/conversation/switch.ts`, the `engine`
  entry): a branch knows the model and family its prompt was frozen for. A
  turn on another model opens a new branch with an `engine` entry — the
  system prompt frozen again, the conversation rendered again by the new
  family (`renderAnswer`: text and calls, no reasoning) — a boundary of the
  frozen prompt like a rebase. « Changer » loads the model; « Brancher sur ce
  modèle » copies the conversation (`ConversationEngine.copy`).
- **The costs announced** (`core/src/costs/announce.ts`; the window's
  `MemoryBanner`, `ContextBanner`, `EngineUnloadedCard`, `ModelSwitchDialog`,
  `settings/LaunchSettings.tsx`): the engine unloaded keeps the conversations
  (« Préparons le moteur » only when no model is known; `EngineState.resume`
  names the one to bring back), its card first above the composer; a send
  meanwhile is held by cancelling `aparte-before-send` (aparté 1.12). The
  model is chosen in aparté's `<aparte-model-selector>`, fed by aparté's
  `createModelCatalogue`; only a pick of the person (`picked`) opens the
  dialog. The engine says « ready » only
  when the core serves a turn, and pushes its changes (`AppEvent` `engine`).
  The launch settings (context, K/V cache) are kept only on a choice, once
  their cost is said; « Moteur et mémoire » shows what runs. With no
  context chosen, a load takes the largest of 32 k, 16 k and 8 k that the
  model was trained for and that fits the card with room to spare
  (`models/cost.ts` `autoContext`; 8 k when the card is not known;
  `EngineLaunchSettings.nCtxAuto`), said in the load's announcement
  (`nCtx`); the first launch offers « Taille du contexte », its gauge
  following the choice, kept as « Moteur et mémoire » keeps it (audit
  2026-11-21, D2).
- **What the model reads** (`core/src/prompt/`, audit 2026-11-21, I1 to
  I3): the stable system turn says who it is and how to work (find before
  reading, read before an edit, edit_file over write_file, never commit,
  push or delete unasked, check with the project's tests, never repeat a
  failed call, follow a refusal, no shell, how to end), a discussion its
  own short method, and the machine's platform — one seed per machine and
  kind. The date, the branch and `git status --short` (`environment.ts`)
  go in the conversation's own turn, read only when its prompt is frozen
  (disarmed on a service: a repository names them); a conversation on its
  own branch not made yet is told that branch and its base, never the
  checkout's state. The project's instructions take about 12 % of the
  context the prompt is frozen for (`instructionsBudget`; a copy or a
  change of model: the target's; not known: 8 k), cut after a whole line
  with a note naming the file — the first folder's relative, another's
  absolute — and the line to read on from; a change past the cut tells
  nothing — the cut the model read, kept beside its text
  (`ConversationMeta.instructionsBudget`), even once the context shrank. The five tools that make a plugin
  are out of the inventory unless « Plugins créés en conversation » is on
  or the conversation asked (« / plugin », `pluginTools`); `ask_user` is
  told in one paragraph (`deltas.ts`), never its schema; a turn on 16 k or
  less does not reason unless its conversation says so (`defaultThinking`).
  The browser's tools say the agent's tab is its own, in a session with
  none of the person's logins. A changed description reaches a
  conversation frozen before as an inventory note — never a re-render.
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
  when its elements arrive). A conversation moves to another project
  (`core.moveConversation`, `conversations.move`): « Déplacer vers… » in its
  row's menu (each list's `moveTargets` are the other projects), or its row
  dragged onto a project's group, which reads the id aparté puts in the drag
  (`application/x-aparte-conversation`: aparté drops only within one list,
  apartejs/aparte#278). Its folders, tools and the project's mode are notes
  at its next turn; refused (`MoveRefusedError`) under a reply (the core
  counts the turns running, a service's while its stream lasts), while a
  question or an approval waits, and on its own branch — said above the
  lists (`.bonaparte-move-notice`, apartejs/aparte#279).
- **The title bar** (`main/title-bar.ts`, `theme/title-bar.ts`, the end of
  `theme/app.css`): on Windows and Linux the system's bar is hidden
  (`titleBarStyle: 'hidden'`) and its buttons drawn over the top right corner
  (`titleBarOverlay`, 40 px), in the page's `--aparte-bg` and
  `--aparte-text-muted` as it resolves them, sent again when the look changes
  (`window.titleBar`; a test run reads `__bonaparteTitleBar`). A fixed strip
  (`.bonaparte-drag`, `index.html`) moves the window; whatever answers a click
  is `no-drag`. The header keeps the buttons' place
  (`--bonaparte-window-controls`, from `env(titlebar-area-*)`) and, narrow,
  gives way by container query: the memory chip shrinks, the text buttons keep
  their icon (their name in `aria-label` and `title`), the chips go under
  520 px. A Mac keeps its own frame. `page.screenshot` does not draw the
  system's buttons: a test measures `env(titlebar-area-*)` instead.
- **The panes** (`renderer/src/panels/`): a column of ours beside the
  conversation (`PanelDock`, as the board draws it), its icons in the header
  (`PanelToggles`, five: Fichiers, Changements, Sous-agents, Navigateur, the
  terminal), each conversation's own (`PanesByConversation`: a new one has
  none, and keeps what it opened once its first message makes it one); under
  1 100 px the pane opened goes over the conversation, alone. A page over the conversation (« À traiter »)
  hides them, mounted (a terminal keeps its view). Fichiers reads
  the core's `files.list`/`files.read` (`core/src/files/browse.ts`, always
  through `resolveInPerimeter`). Changements: the core's preview of a call
  that waits (« Proposé ») and the checkpoint store's changes of the whole
  conversation (« Appliqué »: `files`, `original`, `revertFile`), each drawn
  by aparté's `<aparte-diff>` through `createAparteElement(diffElement)`
  (`diff/DiffView.tsx`, the one place the app draws a change); comments are
  kept by the app (`diff/comments-store.ts`) and leave in one message.
- **Sub-agents** (`core/src/agent/subagents.ts`, `agent/calls.ts`,
  `tools/builtin/run-subagent.ts`; the scheduler's `lend`/`home`): a
  `run_subagent` call is run by the loop, not the registry. Its id is
  name-based (`agent-<uuid>` from the conversation and the call), its
  journal `<conv>/agents/<agentId>/main.jsonl`, its prompt the parent's
  stable system turn and its own project turn as frozen (instructions,
  folders, environment), a note (what the conversation was told since —
  its folders now, its instructions —, no context but the mission, its tools —
  those come after the freeze described —, its mode in a line, its budget,
  the answer first then `path:line`) and the mission; on the wire `agent-start` …
  events with its `agentId` … `agent-end`, and only its result enters the
  parent's journal. At its last round (`maxToolRounds`), or with its context
  past 80 % or short of `REPLY_ROOM`, it gets one last answer without tools
  (the note read with the results; `TurnResult.concluded`) and ends
  `partial`: the main agent reads « cut after N rounds » or « its own
  context », the line `stopped` (apartejs/aparte#285). A pause of one keeps it in the parent's pending entry
  (`subagents`): the resume hands the answers to it, a refusal stops only
  it. Consecutive `run_subagent` calls of a step run together when the
  engine has a second slot (`subagentsOnBuiltin: 'parallel'`, `-np 2`).
  « Moteur des sous-agents » (`subagentsEngine`, « Général »: `conversation`
  or `<service id>/<model>`) runs the new ones on a service
  (`agent/service-subagent.ts`, `routeSubagents`): the same loop and policy,
  each call through aparté's OpenAI-compatible adapter and direct transport,
  no slot of its own — its conversation keeps its slot meanwhile —, ended
  as failed when the service sends nothing for `SERVICE_IDLE_MS` (under
  Node's own five minutes), what it reads disarmed, its journal opening with an `engine`
  entry so a resume goes back there, its line « Nom · modèle »
  (apartejs/aparte#286). A conversation on a service runs its own on that
  service and model, inside aparté's run (`startAgent`): what its mode would
  ask is refused to it there (`askedAsRefused`, apartejs/aparte#287). The
  window (`aparte/subagents.ts`, `panels/SubagentsPanel.tsx`): aparté's
  `setupSubagents` lines, our tracker of the run's events for the pane's
  counts; Stop says « Arrêter les sous-agents » while one works (the
  composer's `stopLabel`).
- **« À traiter »** (`core/src/conversation/inbox.ts`,
  `renderer/src/screens/Inbox.tsx`, Ctrl J): `readInbox` gathers, across
  the conversations not archived, the approvals and sub-agents' requests,
  the questions, the CI that fails, the turns the engine cut (their re-read
  announced, `readAgain` reads them on « Relire et continuer »), and the
  replies finished after `seenAt` (set when the window shows the
  conversation while it has the focus). An approval is answered through
  the approvals store, so the card resolves the same promise as the
  conversation's. A question that is one choice among options is answered
  from the page, through the chat that shows it (`observeElicitations`,
  `aparte/questions.ts`); any other question opens its conversation. The
  page takes the conversation's place and the keyboard focus.
- **Notifications and the notification area** (`main/attention.ts`,
  `main/notifications.ts`, `main/tray.ts`; the core's `onTurnEnd`): each
  turn that ends (done, approval, question, failed — never one the person
  stopped) becomes a banner by `decide` (the person's setting, the window's
  focus and the conversation it shows — `conversations.shown`, null for a
  new one, « À traiter » or the settings: another conversation's event is a
  banner with the window in front too, audit C3 —, « Ne pas déranger »),
  else the badge alone; aparté has no toast for a notice in the window
  (apartejs/aparte#279). The rail shows the conversations that wait, that
  wait for the engine, that answer and those not read, each its dot. The icon's colour and
  the taskbar's badge (`setOverlayIcon`) say what waits as long as it is
  true, read from the inbox. A banner and the icon's menu open a
  conversation (`AppEvent` `open`), never answer it. The icons are drawn
  from four `--bonaparte-tray-*` tokens by `scripts/make-icons.mjs` into
  `resources/icons/` (versioned; `icons/draw.spec.ts` checks them). A test
  run shows none of it: `__bonaparteTray`, `__bonaparteNotifications`,
  `__bonaparteAttention`, and `__bonaparteFocused` to say the window is in
  front (`e2e/fixtures/window.ts`).
- **The terminal** (`plugins/terminal`, `main/terminals/`): the app finds
  the shells (`shells.ts`) and runs node-pty in one Electron utility process
  (`pty-process.ts`, built apart by electron-vite's `?modulePath` — a second
  rollup input split the main bundle), the app's environment minus its
  secrets (`withoutSecrets`). The plugin chooses a shell by id, never an
  executable; a view acknowledges in `term.write`'s callback
  (`plugins.ack`), and while it is behind the shell itself is held
  (`PluginPty.pause`, node-pty's); a view that comes back starts its flow
  afresh (`PluginInstanceChannel.reset`). The main process pushes on one channel
  (`bonaparte:event`, the bridge's `on`): a plugin's events, and the
  agent's commands as `run_command` tells them (`ToolContext.onOutput`).
- **A conversation's own branch** (`core/src/git/`): chosen before its first
  message — offered first, and said why, when another conversation works in
  the project's folder (`projects.folderTaken`: a reply running, a pause,
  changes standing — in a repository those git still shows changed,
  outside one those of the last six hours; audit C4; said plainly without
  git) —
  (`worksIn=branch&branch=…&base=…` on the first turn, a name git
  takes, in any language), made by the loop's `beforeChange` hook before
  its first write or command is judged — so what the card shows, what is
  judged and what is done are all on the branch: `.bonaparte/worktrees/<name>`
  (the next free name, `heures-2`…), only that folder out of the project's
  status through `.git/info/exclude`, a `.env` copied in only when git
  ignores it, locked while it lives. From then on its perimeter is the
  project's folders at the same place in the worktree (`branchRoots`), told
  at the next turn as a note; the project's own checkout is refused
  (`PermissionQuery.barred`). A branch that cannot be made is said to the
  model as the call's failure; the turn goes on. Its
  pull request: `CoreDeps.gh` (`gh`; a fake CLI in tests,
  `testing/fake-gh.mjs`; null in a test run that gives none — a test never
  asks GitHub). Archived, the worktree is let go, removed with its branch
  30 days after — never with work not committed in it.
- **The plugin host** (`core/src/plugins/host.ts`, `packages/plugin-sdk`):
  a manifest read before anything runs; one context per activation, torn
  down as one (its tools, its commands, its signal, its processes and
  terminals); a tool reaches the machine only through `use(<core tool>)`,
  within its declared effect, judged by the permission engine in its
  conversation's mode (`granted` lets pass what only the mode asks). A
  built-in plugin imports no `fs`, `net`, `http(s)`, `child_process` nor
  `node-pty` (lint). A project may turn a plugin off (`visibleTo`).
- **Services** (`core/src/providers/`, `core/src/agent/endpoint.ts`;
  task 9.1 to 9.3): `ProviderRegistry` keeps the services in
  `config/providers.json`, their keys in the vault (`<id>.key`), never sent
  back to the window. `probeEndpoint` asks `/props` (llama.cpp), then
  `/v1/models`, within 5 s. A conversation on a service (`engineId` the
  service's id) runs in aparté's `createAparteAgentHandler`, wrapped by
  `serveOnService`: the core's registry, `PermissionEngine.evaluate` as its
  approval policy, `ask_user` as the window's tool, a call bounded by its
  own tool and two hours as a net (`SERVICE_TOOL_TIMEOUT_MS`: aparté's five
  minutes stopped the run, apartejs/aparte#290); its turns are written to
  the journal without `rendered` (a service keeps no memory). Every service
  is OpenAI-compatible, a llama-server already running too (`<address>/v1`);
  the built-in engine alone speaks `/completion`. A first turn with
  `?provider=&model=` starts there; `switchProvider` leaves the built-in
  engine (an `engine` entry with no family), `switchModel` comes back,
  rendered again. A service conversation has no memory mark and no gauge,
  and a send to it never waits for the built-in engine. Tests use
  `testing/fake-openai-server.ts`.
- **The discussion** (task 9.7): a conversation without a project
  (`kind: 'discussion'`, `?kind=discussion` on its first turn) has the
  network tools only and Lecture, no mode switch, no code panes — and
  the whole built-in browser on web pages (Paul, 2026-11-20): its tools
  (`toolsFor`; `browser_open` told by its manifest's `discussion` words,
  an address only), its « Navigateur » pane and Ctrl Maj B, never a file;
  `browser_act` asked each time there (`PermissionEngine.forDiscussion`),
  never refused by its Lecture, never free; its prompt names no folder;
  `attachProject` makes it a code conversation, the project and its tools
  told as notes at the next turn. At launch, a new conversation starts in
  the project made last.
- **The first launch** (`renderer/src/screens/FirstRun.tsx`, task 9.6): shown
  until an engine is chosen — a model known or a service added. The models
  recommended (`core/src/models/catalogue.ts`, read on the hub's official
  repositories) per tier of video memory; `downloadModel` puts one in
  `<data>/models`, a root of the inventory (source `bonaparte`), its SHA-256
  checked. A test run never asks Hugging Face (`modelHub: null`; the e2e
  fixture's `hub` is a local one, `testing/fake-model-hub.ts`). `core.doctor()`
  (`core/src/doctor/`) is what `bonaparte doctor` prints.
- **The built-in browser** (task 10.1, `main/browser/views.ts`,
  `main/browser/service.ts`, `plugins/browser`, `panels/BrowserPanel.tsx`):
  one `WebContentsView` a tab, in a session made by one factory that puts
  the four guards on every one (`main/browser/sessions.ts`): the person's
  tabs in `persist:bonaparte-browser`, an agent's in its project's
  `persist:bonaparte-agent-<project>`, or in memory one per conversation
  with no project (`bonaparte-agent-conversation-<id>`, hashed when the id is
  no safe name) — never the person's cookies (the browser redo, step 2); in
  an agent's session a request no page names (a service worker's) is judged
  as its page's (`blockedWithoutPage`), in the person's it passes —,
  http(s) only, never `bonaparte://` — and one `file:`: a file of the
  conversation's folders the agent opened (`browser_open` with a `path`, or
  a `file:///` address: a read, `effectOfCall`; one tool opens a page or a
  file, Paul, 2026-11-20 — `browser_open_file` is kept `hidden` for the
  conversations told of it, and says to use it), checked by the host
  (`openPerimeterFile`: in the perimeter, its links resolved, a file; never
  for a discussion), its page loading from the folder of the perimeter that
  holds it and from nowhere else of the disk — every `file:` request judged
  where it really lands, its links resolved (`fileIn`, the tab's `fileRoot`)
  — and reaching the network only where the conversation may without asking
  (`fileAccess`), else kept offline and said so: opening a file is a read,
  never a way round the network's ask. The pane keeps a slot and says where it
  is (`browser.place`, measured on resize and every 300 ms); the page is
  taken off whenever anything covers it — a dialog, a page over the
  conversation, the pane hidden — since a native view sits above the
  window's page. The agent's `browser_open` (an address: network, loopback
  and public addresses, never a private one), `browser_read` and `browser_screenshot`
  (read) and `browser_act` (execute) work on their conversation's own tab
  (`agent:<conversation>`, made at its first page, marked « Agent » in that
  conversation's pane and in no other's; each conversation's pane keeps its
  own tab shown (`shownBy`, set by `browser.place` for the conversation it
  names, never inferred from what is attached): the agent's page becomes
  its conversation's, unless that pane is visible and shows the person a
  tab of their own — a blank « Nouvel onglet » too, placed `blank`, not
  covered —, where it waits behind theirs marked « Nouveau » (`fresh`),
  shown once that pane no longer shows it; closed when its conversation is
  deleted or archived,
  `closeAgentTab`) and never on a tab of the person's, through
  `BrowserService` — each call carries its conversation, and the host adds
  the project the core knows it in (`fileAccess`) —, given by the host only
  to a plugin that declares the network. `__bonaparteBrowser` is the
  end-to-end tests' handle (`placement`, `states`, `click(tabId, selector)`,
  `capture(tabId)`): a test clicks in a person's page with `click`, since
  Playwright drives the window, not the native view.
- **The person's tools on a page** (task 10.2, `views.pick`/`cancelPick`/
  `pins`, `panels/PageTools.tsx`, `panels/BrowserConsole.tsx`): an injected
  script outlines what the pointer is over, in the accent the window resolves
  (`browser.pick` accepts only a colour), and gives back the element clicked;
  Escape leaves. What is joined is an aparté pill (`attachToken` in
  `aparte/composer.ts`: the label shown, the full description in the
  message), at the caret or after the draft (aparté 1.14,
  apartejs/aparte#259); the comments leave as one message in the person's
  name. Electron's own « Electron Security Warning » lines are no page's:
  the console drops them.
- **What a project runs** (task 10.3, `core/src/project/runs.ts`,
  `panels/NewTab.tsx`): the scripts of its package.json whose name says
  they serve a page, and its compose services, launched as
  `[manager, 'run', name]` or `docker compose up <name>` through
  `spawnTree` (a script name is checked first: `dev & calc` launches
  nothing), the app's environment minus its secrets; their output in the
  conversation's terminal tab; the address read from whole lines, then
  waited for until its port answers. `alreadyRunning` probes the usual
  ports. The window names a conversation or a project, never a folder.
- **The web search** (task 10.4, `core/src/search/`, `plugins/web-search`,
  `main/search/hidden-page.ts`): `web_search` (network) searches the public
  engine in a hidden page of its own session that reaches the engine's host
  only, or an online provider whose key is in the vault (`search-<provider>`);
  `webSearchProvider`, `webSearchUrl`. A test run's engine is a local page
  (`BONAPARTE_E2E_SEARCH_ENGINE`, 127.0.0.1 only).
- **MCP servers** (task 10.5, `core/src/mcp/`, `settings/McpServers.tsx`):
  `config/mcp-servers.json`, an entry's `project` its scope; a stdio server
  through our `HiddenStdioTransport` (`spawnTree`, no shell, its whole tree
  stopped), `npx`/`npm` through node and npm's own script, an npm shim
  `.cmd` read for its script, any other `.cmd`/`.bat` refused; HTTP servers
  through the SDK. Tools `mcp__<server>__<tool>`: `readOnlyHint` makes one
  network (it still leaves the machine), the rest execute. Started in the
  background by a conversation's first turn, or « Démarrer »; a file that
  cannot be read is never written over. Tests use
  `testing/fake-mcp-server.mjs`.
- **Plugins added** (task 11.1, `core/src/plugins/install.ts`, `state.ts`,
  `added.ts`, `remote.ts`; `main/plugin-host/`): `PluginInstaller` stages a
  source under `<data>/plugins/.staging/<uuid>` — a folder copied without
  `.git`, `npm pack --ignore-scripts` unpacked by the system's `tar`, or
  `git clone --depth 1 -c protocol.ext.allow=never` — and its preview is
  read from there; installing moves it to `<data>/plugins/<id>/`. What is
  added, its source and who switched it off live in `config/plugins.json`
  (`PluginState`, never written over when it cannot be read). Each plugin
  runs in one Electron utility process (`plugin-process.ts`, built apart
  with `?modulePath`), the app's environment minus its secrets, talking by
  messages (`remoteModule` ↔ `runPluginChild`, the core's subpath
  `@aparte/bonaparte-core/plugin-child`); a crash tears its context down,
  never the app. `AddedPlugins` activates them at start (a folder put there
  by hand counts as one added from that folder).
- **A plugin's view** (task 11.2, `main/plugin-host/protocol.ts`,
  `panels/PluginFrame.tsx`, `plugin-frame-relay.ts`, `shared/src/plugin-view.ts`,
  `plugin-sdk/src/view.ts`, `react.ts`): `bonaparte-plugin://<id>/` serves
  the view's files under a strict CSP, a trial's under `@<rev>/`, and the
  kit's sheet with our tokens at `/@bonaparte/kit.css`; the window allows
  only that scheme in its frames (`frame-src`). The frame is
  `sandbox="allow-scripts"`, without the preload; it speaks on one channel
  (`bonaparte-view`), the relay checking each message's source and shape
  (`readFromView`). Its pane is `plugin:<id>:<pane>` in the dock.
  `defineView` and `defineReactView` are what an author imports.
- **« Réglages · Plugins »** (task 11.3, `settings/Plugins.tsx`,
  `dialogs/AddPlugin.tsx`, `settings/WebSearch.tsx`,
  `settings/ProjectExtensions.tsx`, `core/src/plugins/entries.ts`): the
  core's own functions are entries switched like plugins (`subagents`
  takes `run_subagent` out of the inventory, `project-scripts` empties
  `runs.list`, `auto-titles` gives aparté's `setTitleProvider` the untitled
  word); a project's page lists its MCP servers and plugins, one switched
  off for it alone (`visibleTo(projectId, conversationId)`). The search
  engine's key goes to the vault as `search-<provider>`.
- **A plugin made in a conversation** (task 11.4, `core/src/plugins/extensions.ts`,
  `guide.ts`, `tools/builtin/extensions.ts`; `aparte/extension-card.ts`):
  `ExtensionStore` keeps each definition as a revision of its own under
  `<data>/extensions/<conv>/<id>/<rev>/`, checked by `node --check`
  (Electron as node) and never run; `harness_inspect` (read) gives what is
  active and `PLUGIN_GUIDE` (`docs/plugin-guide.md` is equal to it),
  `extension_define` (write), `extension_run` (execute: its card shows the
  code as a diff from nothing), `extension_stop` and `extension_undefine`
  (ui) — never a sub-agent's. A trial is visible to its conversation only
  (`host.trialIn`); « Installer » makes it a plugin added from it. Its
  « / » commands come from `PluginStatus.commands` through
  `aparte-collect-commands`, a trial's with the badge « À l'essai », on its
  row while the list is filtered too (aparté 1.14, apartejs/aparte#261).
- **Shortcuts** (`renderer/src/shortcuts/registry.ts`, `useShortcuts.ts`,
  `settings/Shortcuts.tsx`; task 12.1): one registry of actions and their
  default combos (`SHORTCUTS`), the person's own in the `shortcuts` setting
  (type `keys`, checked by `COMBO` in the core); `useShortcut(action, run)`
  is the only way a screen binds one, a change is said on the window
  (`bonaparte-shortcut`). While a combo is captured nothing fires
  (`CAPTURING`). Escape stops the reply: in the composer, aparté's own
  `stopKey` (aparté 1.14); elsewhere in the window, our listener, only when
  no overlay is visible (`checkVisibility`: aparté's selects keep hidden
  listboxes in the page) and the key was not cancelled already. A reply the
  engine cut says so in its own bubble, after a reload too: the error
  renderer reads `appCode` and draws only that card (`aparte/errors.ts`,
  apartejs/aparte#265); every other error is aparté's own card (aparté 1.15,
  #267).
- **The mascot** (`renderer/src/logo/`, task 12.2): `mascotState` derives
  its state from the runner's events (`TURN_ACTIVITY`, `aparte/runner.ts`)
  and the engine's; « content » lasts `HAPPY_MS`. Its keyframes move only
  transform and opacity, and stop under reduced motion. The app's icon
  (`main/icons/draw.ts` `appIcon`) is drawn with the tray's icons by
  `scripts/make-icons.mjs`.
- **Failures** (`core/src/failures.ts`, `renderer/src/failures/`; task 12.3):
  `decideLoad` refuses a model too big before anything is launched
  (`ModelTooBigError`, its offload said by `suggestOffload`); `planDiskRoom`
  keeps `DISK_MARGIN_BYTES` free and names the memories it would let go;
  `engineLog()` keeps the last lines of a llama.cpp that died;
  `useLlamaBinary` takes a file the person chose in the system's dialog,
  never a path from the window, and asks the card again of it. The layers
  « Une partie sur le processeur » keeps hold for that model only
  (`engine.gpuLayersModel`); « Tout sur la carte », in « Moteur et
  mémoire », puts them back. The engine's log is the one that died, even
  once relaunched, until a start asked for. One `FailureCard` draws them
  all, in the kit's tones (danger, warning, neutral).
- **A conversation's own settings and the resource monitor** (task 12.4,
  `core/src/plugins/entries.ts` `conversation-settings`, `resource-monitor`):
  `ConversationMeta.temperature` and `thinking` reach the sampling of the
  conversation's next turn; the cap is `contextCap`. The monitor samples
  only while a window wants it (`resources.start`), pushed as `AppEvent`
  `resources`; a test run's readings are fixed (`BONAPARTE_E2E_RESOURCES`).
- **The updates** (task 13.1, `core/src/updates/check.ts`, `main/updater.ts`,
  `main/ipc/updates.ts`, `dialogs/Updates.tsx`): `core.updates()` gives
  llama.cpp's build and the models' new versions (a catalogue entry that
  `replaces` a file on the disk), each with its cost — the conversations whose
  memory is for the old file, read again one by one; the main process adds the
  app's own (electron-updater, in a packaged app only; a test run's from
  `BONAPARTE_E2E_UPDATE`, `__bonaparteUpdater`). Nothing installs under a
  reply (`core.whenIdle()`, the supervisor's `whenFree`). `autoUpdateApp`:
  downloaded in the background, installed at the next quit. The entry is in
  the sidebar and the rail, only when one is ready.
- **What runs on Windows** (`core/src/process/spawn.ts`, audit 13.4): a
  bare program name is resolved on the PATH's full entries only (`.com`,
  `.exe`, the name with a dot as Windows completes it), never in the folder
  it runs in — a `git.exe` a repository carries; one not found launches
  nothing. A program counts by `lstat`: an app execution alias (python,
  winget) is a link the file system cannot follow. A test that injects
  `spawn` without `exists` describes its own machine. git, gh (its own
  token kept), the probes and every plugin process get no secret; the
  ssh-agent's socket is not one. npm, npx, pnpm, yarn and every tool npm
  installs are `.cmd` shims there, which only a shell runs: `resolveCommand`
  (`core/src/process/command.ts`, for MCP, a project's runs, `npm pack` and
  `run_command` alike) runs them as node and the script the shim names
  (npm's cmd-shim, corepack's and `node_modules\.bin`'s forms; npm's own
  script with the PATH's node when none is beside it). Any other batch file
  is refused, saying why; `run_command` says a program the PATH lacks in
  words, never « spawn … ENOENT » (audit 2026-11-21, D1).
- **What a tool gives back** (`core/src/tools/output-cap.ts`, `edit-text.ts`;
  audit 2026-11-21, D4 and D5): an output past the cap is cut in the middle,
  a third of the head and two thirds of the tail, the note counting the
  lines and characters left out and fitting in the cap; `run_command` keeps
  its head and its end while it runs, `read_file` cuts after a whole line and
  gives the offset to go on from. `edit_file` matches old_string whatever the
  line endings and writes the file's own (`write_file` keeps a CRLF file's
  too); the approval's preview makes the same match through `applyEdit`.
- **Outside text, on a service too** (`families/service-tokens.ts`, audit
  13.4): what a service's model reads — tool results, descriptions and
  schemas (keys included), the history, the project's instructions — is
  disarmed for every family a service may run (Gemma, Qwen, Mistral,
  Llama 2, DeepSeek, any `<|name|>`); what the model writes back has the
  disarming marks taken off (`restoreDisarmed`, in edit_file and
  write_file). A third party's plugin tool is judged as a program it runs:
  refused in Lecture, asked elsewhere, never a read-only sub-agent's.
- **The installer and the command** (tasks 13.2 and 13.3,
  `packages/app/electron-builder.yml`, `.github/workflows/release.yml`,
  `packages/cli/src/launch.ts`, `scripts/assemble-app.mjs`): the workspace is
  bundled into `out/` (the app's devDependencies), only the third-party
  dependencies ship; node-pty is out of the archive. A tag publishes a draft
  release. The npm package carries the built app (`app/`, assembled on
  `prepack`, removed on `postpack`), core and shared bundled, and the app's
  run-time dependencies at the same versions (a test pins it).
- **The settings** (`renderer/src/settings/`): over the shell, which stays
  mounted and hidden (a reply goes on). The app's settings live in the
  core's `SettingsStore` (`config/global.json`, under `settings`), checked
  against `APP_SETTINGS`; a change is said on the window
  (`bonaparte-setting`), the look is applied to the root
  (`theme/appearance.ts`), the language by asking the main process again
  (`bonaparte-locale`) — an open conversation hears it as a note at its next
  message. The permission engine reads `askBeforeNetwork` and `alwaysAsk`
  (global, and a project's own list). The network is asked in Lecture,
  Répétition and Plume while `askBeforeNetwork` is on, never in Impro (Paul,
  2026-11-20); a third party's plugin asks in every mode, whatever it says.
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
  the empty thought channel. Each layer says how its models are sampled
  (`sampling({ thinking })`, from the makers' model cards: Gemma 4 1.0 /
  0.95 / 64, Qwen3 0.6 / 0.95 / 20 thinking, 0.7 / 0.8 / 20 without, min_p
  0), sent with every completion, the conversation's temperature over it
  (audit 2026-11-21, D6); the catalog's `SAMPLING_SETTINGS` reach no turn.
- **The engine** (`packages/core/src/api.ts`, `engine/`): `createCore` owns
  the supervisor; asking about the engine runs nothing, a load is the only
  thing that launches llama.cpp. The card's memory is what llama.cpp lists
  (`--list-devices`), the registry only after it.
- **llama.cpp kept by bonaparte** (`engine/llama-release.ts`,
  `models/download.ts`, `engine/llama-install.ts`): the Vulkan package on
  Windows and Linux, Metal on a Mac; a package without GitHub's SHA-256
  digest, or from anywhere but llama.cpp's releases, is never offered;
  unpacked by the system's `tar` (Windows' own, by its full path).
- **The Visual C++ runtime** (`core/src/engine/llama-runtime.ts`,
  `app/src/main/vcruntime*.ts`, `app/scripts/prepare-vcruntime.mjs`):
  every binary of llama.cpp's Windows package imports msvcp140,
  vcruntime140 and vcruntime140_1, and the package carries none — on a
  Windows without them the server stops before its first line
  (0xC0000135). The app carries them, copied at pack time from Visual
  Studio's `VC\Redist` folder (the only source its licence allows; never
  committed; the newest found, a warning when older than what built
  llama.cpp: `MIN_RUNTIME`),
  unpacked beside app.asar and in the npm package. `llamaFound()` puts
  them beside the llama.cpp bonaparte installed only when System32 has
  none as recent, and takes its copy away once Windows has one (Windows
  Update keeps that one current). An engine that stops without a word
  says why (`EngineStoppedError.reason`): the runtime missing or too old
  (« Installer le runtime de Microsoft »), else its exit code.
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
- **Two inputs in electron-vite's main build split it**: the dynamic
  import of the app becomes a chunk, and `import.meta.dirname` moves (the
  preload was not found). A utility process is built apart with
  `?modulePath`.
- **Bash's heredocs eat backslashes** in this environment: a file with
  `\n`, `\u0000` or a Windows path is written with the Write tool, never
  through a shell heredoc — one edit left raw control characters in a
  source file. And Python's text mode writes CRLF on Windows: a script that
  edits a file opens it with `newline=''`.
- **Windows' `core.autocrlf`** turns a test repository's checkout into
  CRLF: the temporary repository sets it off. On Windows a folder also
  stays busy while a git that just ran in it exits: its removal is retried.
  A launch of the fake engine takes about a second there, so the core's
  tests have 30 s each (`vitest.config.ts`): a test of a relaunch after a
  crash takes 8 s alone, more under the load of every package.
- **xterm 6 keeps its old viewport** behind the scrollbar it draws itself:
  black, with a native bar, seen under the last row the fit leaves unless
  it is styled (`.xterm-viewport`).
- **A radio hidden by a screen-reader-only class is not clickable** for a
  test (nor by any tool that targets it): draw it transparent over its
  label instead.
- **A test that relaunches on the same data folder** must keep what the app
  wrote there: the fixture merges the settings it finds.
- **A native view is absent from a picture of the window**: `page.screenshot`
  draws the window's page only. The screens of the browser lay the view's
  own picture (`capturePage`) where it sits.
- **A test that a process tree dies proves nothing on Windows** unless the
  child is spawned `detached`: the job object kills the grandchild anyway.
  And npm runs a script through cmd: a test's script is a file, never
  `node -e` with quotes.
- **A dev server's address can arrive cut across two chunks**
  (« http://127.0.0.1: », then its port): read it in whole lines.
- **The tool inventory weighs some 3,200 tokens of the fake engine**: the
  e2e fixture's engine has a context of 16 k by default.

- **llama.cpp resumes a sliding-window model from a checkpoint** (b11558,
  read in its source and checked by two readers): a shorter prefix, and the
  first request after a restore, resume from the newest checkpoint at or
  before it; checkpoints are made only while a prompt is read — at the start
  of an appended segment of at most 516 tokens, else 516 before its end,
  and 4 before its end —, the oldest and the 30 newest kept, about 200 MiB
  each in f16, saved with the slot. A state saved right after an answer
  would re-read that answer: the engine reads the prompt to its end first
  (`nPredict: 0`, `settle`). `--cache-ram 0`: no hidden copies in RAM.
- **A chat writes its thread back when it unmounts**, and aparté's React
  chat only moves its head on `truncateFrom`: take the chat down before the
  core swaps a branch's document, then mount it again.
- **llama-server says « ready » before the core knows the model it loaded**:
  a window told « ready » sent into a 409. The engine is « ready » only when
  the core serves; a load ends by telling the window again.
- **`supervisor.configure` tears the server down without saving**: the
  memory is flushed first when another model replaces the one that runs.
- **A real model summarising long prose drops a fact a file gave**: asked
  only to « keep the facts », Gemma 4 26B lost the code word; asked to « keep
  every fact word for word », it wrote past its cap. A summary in two parts
  — « Facts: » quoted exactly, then « Work: », at most 500 words — kept it.
- **A state is « behind » only for text frozen before the turn**: a going
  back, a pause or its answer freeze none, and the notes a turn appends are
  read with its message — else a restore that served everything was said
  as a re-reading.
- **aparté's `setModelConfig` merges**: a model chosen cannot be cleared by
  leaving it out. And a send is held by cancelling `aparte-before-send`
  (aparté 1.12), never `aparte-send`, which cannot be cancelled.
- **The context is the engine's count, not an estimate.** Three characters a
  token overcounts prose: the banner said 92 % beside a gauge at 69 %, a
  message the engine had room for was refused, and « Compacter » found no
  room in a conversation the engine held at 90 %. An answer keeps what the
  engine held once it was written (`usage.contextTokens`, llama.cpp's
  `tokens_cached`); the banner and the room checks start from it
  (`countedContext`), with an estimate only for what was frozen since. The
  fake server counts four characters a token: a test that fills the context
  fills it as the engine counts.
- **A turn lends its slot to its sub-agents.** With one slot, a sub-agent
  that waited for the slot its own turn holds would wait forever: the turn
  lends it (the parent's state saved if it changed, the borrower's
  restored), and takes it home before its next completion. And a turn never
  waits for a slot while it holds one: two conversations doing that at once
  (« En parallèle ») waited for each other for ever — a step's sub-agents
  take only the slots free now, the others run on the lent slot.
- **What a job leaves worth nothing, it says before it ends**
  (`slot.discard()`, `lent.discard()`): the next owner in line takes the
  slot the moment the job ends, and would save it — a finished sub-agent's
  state, a gigabyte on disk pushing another conversation's memory out.
- **The notification area never stops the app.** Every drawing reads the
  inbox, every journal: a drawing that fails is logged, one journal that
  cannot be read hides only its conversation, and quitting (the memory
  saved) is wired before the first drawing, which nothing waits for.
- **Any change of aparté's config redrew every conversation list at
  once** before aparté 1.12, an open row menu or rename with it
  (apartejs/aparte#251, fixed): a
  provider registered, `setModelConfig`, a tool display. Tell aparté only
  what changed (`showCatalogue` keeps quiet when its list is the same), and
  nothing at all with a remote engine (no picker).
- **A card that takes the focus does it in a layout effect**, before it is
  painted: with `useEffect`, an Enter typed as the approval card appeared
  reached the composer — where, while a turn waits, it stops the reply.
- **`NO_COLOR` in the shell, with Nx's `FORCE_COLOR`, makes Node warn into
  the output of the fake binaries**, and the core's tests that read it
  fail: run the tests without `NO_COLOR`. A test that proves two things run
  at the same time paces the fake engine slowly enough for a loaded machine.
- **The window of a test run has the focus** (`document.hasFocus()`), but
  the main process's `isFocused()` says no: a test of the notifications
  says what the person faces through `__bonaparteFocused`.
- **aparté's composer submit stops a turn that is still open**: a turn paused
  on an approval or a question keeps the composer `streaming`, and
  `submit()` then cancels it. Nothing is submitted for the person under such
  a turn (« Charger et envoyer »).
- **A send the page holds leaves the field as it was; one that goes empties
  it**, in the same call: that is how `sendAsPerson` knows a message in the
  person's name was held (the engine unloaded). It waits for
  `bonaparte-engine-ready`, the person's draft back in the field.
- **A compaction's checkpoint is placed on the thread as it stood when the
  compaction began**: a message sent while the summary is written is
  journaled after the rebase, and must stay after the checkpoint.
- **An answer from « À traiter » can only go where the engine is**: with the
  engine unloaded, a resume is a 409 and the answer is lost — the page offers
  neither « Autoriser » nor a question's choices then. A question's choices
  are shown only when the question its chat shows now has the card's words.
- **A test of a redraw marks the elements it watches** (an expando on the
  comment field, on a line number) and checks they are the same after a
  render of the app: a field can survive a redraw its rows do not.
- **Electron 45's utility process ignores Node's `--permission`**
  (`process.permission` is undefined there): a plugin's process is a plain
  Node process. What keeps it apart is the process itself, its environment
  without secrets, and the host that hands it only what its effects allow.
  And a plugin that spawns `process.execPath` relaunches Electron, not Node.
- **`?raw` of a package's file fails in electron-vite's main build**
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`): import it by a relative path into
  `node_modules` (the kit's sheet, apartejs/aparte#260).
- **aparté's « / » list hides its group headings while a filter is typed**
  (apartejs/aparte#261): a test that reads a group types « / » alone.
- **The kit's alert has no « error » tone**: `aparte-alert--error` draws a
  note's colour. Its tones are danger, warning, success, info, neutral, primary and secondary;
  `theme/kit-classes.spec.ts` refuses a tone the kit does not define.
- **Chromium's Tab goes on from where the focus was**, not from the top: a
  test of the Tab order focuses a mark at the start of `body` first.
- **The managed fake engine ignores the fixture's `responder`**: it is a
  binary of its own, which answers `FAKE_LLAMA_ANSWER`.
- **A Gemma 4 state weighs far more than its full-attention layers**: the
  sliding windows and llama.cpp's checkpoints are saved with it (1,156 MiB
  for 1,416 tokens). Room on the disk is counted from what the states of
  the model weigh, measured, not from `kvBytesPerToken`.
- **`appSettings.setEngine` does not reach a config already read**: a load
  that offloads layers drops the cached config (`config = undefined`)
  before it launches.

- **A turn holds the slot before it is resident**: as a turn ends, the
  conversation is the scheduler's `busy` owner, not yet its resident — a
  question asked then (the disk check, the updates' count) counts it as in
  the engine either way.
- **electron-updater's background download rejects on its own**:
  `checkForUpdates()` hands back a `downloadPromise` that nothing catches,
  and an unhandled rejection closes the app. And `quitAndInstall` starts
  the NSIS installer first, which kills the app within seconds: the memory
  is saved before, not in `before-quit`.
- **`existsSync` is false for a Windows app execution alias** (the Store's
  python, winget), which Windows runs: look for a program with `lstat`.
- **electron-builder unpacks native modules by itself**, `asarUnpack` or
  not: a test of the packed app proves node-pty by running a shell.
- **Electron 45 gives the address a request went to** only on a redirect
  (`onBeforeRedirect`'s `ip`), and behind a proxy it is the proxy's:
  Chromium's own resolution (`session.resolveHost`, its cache) says where a
  page is.
- **A clean Windows is not the developer's machine**: llama.cpp's official
  package needs the Visual C++ runtime, which every developer machine has
  and Windows Sandbox does not. A program Windows could not load exits
  0xC0000135 without a line; the card read that as llama.cpp's own words.
  An exit code arrives as Windows gives it (`>>> 0` to compare), and
  Node's `process.exit(0xC0000135)` keeps it whole on Windows only. Test an
  install in Windows Sandbox before saying it works on any machine.
- **One `turn-start` per call to the model, a `text-flush` before it.**
  aparté starts its reasoning and text blocks afresh only on a `turn-start`
  (its own runner sends one before each model call, a sub-agent's under its
  `agentId`, and a `text-flush` at each call's end); the core sent one per
  reply, so every later round's reasoning went into the first block, already
  settled (« Réflexion terminée » while it still came). And aparté's parser
  holds a text that ends on a backtick until more comes: without a flush, a
  turn-start or the run's end dropped it (« La valeur est » for « La valeur
  est `42` »). A sub-agent resumed after a pause opens a turn too. No test
  saw it: no fake model reasoned and called tools in the same reply.
- **A sub-agent's grammar admits every tool its prompt shows.** It shares
  the conversation's frozen prompt, whole inventory included; a grammar of
  its own tools only bent a call it meant (`write_file`, in « read ») into
  the nearest name allowed (`browser_read`), 18 times in a row on a real
  model. Its registry refuses what is not its own, in words it can act on;
  the same call failing three times stops it, and a reasoning past
  `SUBAGENT_THINKING_CHARS` cuts its answer — both said to the main agent.
- **Two clocks already bound a call to a service**: aparté's handler gives
  every tool call five minutes and then stops the whole run
  (apartejs/aparte#290), and Node's fetch gives up after five minutes
  without a byte (undici's headers and body timeouts), as « fetch failed ».
  A bound of ours sits under the second and over the first. A test of them
  fakes `setTimeout` alone (`vi.useFakeTimers({ toFake: [...] })`): undici
  follows it too.

## Real-model smoke results

Record here: the date, the model, the llama.cpp build, and the outcome of each
case. The newest entry comes first.

- **2026-11-18, phase 10 — the MCP case green** (run alone, twice: the
  second time to read its figures). Gemma 4 26B-A4B-it UD-Q4_K_XL,
  llama.cpp b12383 Vulkan, Radeon 8060S, `-c 8192`, K/V f16, one slot,
  aparté 1.13.0, loaded in 14 s (35.6 GiB of RAM free). The official
  filesystem MCP server, through `npx -y @modelcontextprotocol/server-filesystem`
  (resolved to node and npm's own script, launched hidden, no shell),
  connected in 5.9 s with its 16 tools; its `read_text_file` says it only
  reads (`readOnlyHint`), so it is asked as the network: the real model
  called `mcp__files__read_text_file` with the file's path, the turn paused
  for approval, and once approved the tool read the file and the model
  answered « MARJORAM ». The last round: 4,539 of 4,568 tokens served by
  the cache — the MCP tools told as a delta of the inventory, the frozen
  prompt untouched. A real web search was not run (it leaves the machine:
  optional, not asked).
- **2026-11-18, phase 8 — 17/17 green** (the change of model skipped: no
  second model given). Gemma 4 26B-A4B-it UD-Q4_K_XL, llama.cpp b12383
  Vulkan, Radeon 8060S, `-c 8192`, K/V f16, `--cache-ram 0`, aparté 1.13.0,
  loaded in 9 s (45.8 GiB of RAM free, for 16.7 GiB announced). The fifteen
  cases of phase 7 again (restore of 1,401 tokens in 1.4 s, all served;
  branch 1,423 of 1,433; seed 1,318 of 1,318; the agent's last round 1,422
  of 1,445; reload restored in 1.4 s, restart in 16.6 s restored in 2.6 s;
  Stop 122 ms; going back 30 read of 1,472; a compaction 5,789 → 2,128
  tokens kept the code word), and two of phase 8, through aparté's runner
  and the handler: three real sub-agents in turn on the slot their turn
  lends, each reading its file and giving its word back, in 28.4 s — the
  conversation's last round served by the cache but for 50 of 1,686 tokens,
  its memory home again; then « En parallèle », said first (2 slots,
  0.35 GiB each), the engine relaunched with two slots in 25.5 s, two real
  sub-agents with neither waiting for the engine and llama.cpp's `/slots`
  showing both working at once, in 30.8 s, the last round 33 read of 1,899.
  One finding, in the smoke itself: « the second called its tool before the
  first ended » is not « together » — a sub-agent's first completion takes
  seconds; the verdict reads llama.cpp's slots.

- **2026-11-16, phase 7 — 16/16 green.** Gemma 4 26B-A4B-it UD-Q4_K_XL,
  llama.cpp b12383 Vulkan, Radeon 8060S, `-c 8192`, K/V f16, one slot,
  `--cache-ram 0`, loaded in 45 s (58.4 GiB of RAM free, for 16.7 GiB
  announced); Qwen3-1.7B Q4_K_M for the change of model. The twelve cases of
  phase 5 again (restore of 1,254 tokens in 1.1 s, all served; branch 1,276
  of 1,286; seed 1,171 of 1,171; the agent's last round 1,275 of 1,298; the
  reply language 1,256 of 1,306; unload and reload restored in 958 ms,
  restart in 26.6 s restored in 1.5 s; Stop 122 ms), and four of phase 7: a
  conversation saved right after a long answer (163 tokens) comes back with
  1,416 of 1,434 tokens served — 18 read, its last answer not read again
  (the state file: 1,156 MiB for 1,416 tokens, llama.cpp's checkpoints in
  it); going back before the last message was announced « kept » and read
  30 of 1,325 tokens; a compaction (5,349 → 1,880 tokens, estimated) kept
  the code word a file gave, and the model answered it from the summary; a
  change to Qwen announced 1,580 tokens to read again for a prompt of
  1,112, and the conversation answered « SAFFRON » in the new family. Three
  findings, fixed before this run: a going back said as a re-reading the
  restore served; the summary lost the code word under five long essays
  (now asked in two parts, « Facts: » quoted exactly, then « Work: »); and,
  once asked to keep every fact word for word, it wrote past its cap.
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
