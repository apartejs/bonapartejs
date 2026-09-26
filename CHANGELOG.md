# Changelog

All notable changes to bonaparte are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Every `@aparte/bonaparte*` package
ships at one version.

Until the first release, this file is written by hand from the commit history;
changesets take over at 0.1.0.

## [Unreleased]

Everything below was built between 2026-08-18 and 2026-09-26 and has not been
published.

### Added

- **MCP servers** (P4). bonaparte is an MCP client, over stdio and
  streamable HTTP, on the official SDK. Servers are declared in
  `mcp-servers.json` (in bonaparte's config folder), in the shape every MCP
  guide shows — `{ "mcpServers": { "<name>": { "command", "args", "env" } |
  { "url", "headers" } } }` — so a server's documented snippet pastes as
  is. They start with the app, in the background; their tools join the
  model's list as `mcp__<server>__<tool>` and reach a conversation as an
  inventory delta, never a re-render. The hub's "MCP servers" section lists
  each with its state, its tools or what it said when it failed; a server
  is added from a command line or a URL, switched off, retried or removed,
  and the file follows (entries it cannot read stay untouched, and are
  named). MCP tools go through the play modes like ours: one its server
  marks read-only counts as reaching outside (it asks in Reading and
  Rehearsal), anything else as a command; "always allow" works per tool. A
  server that dies mid-session is reported and its tools leave; nothing a
  server started outlives the app — on Windows the process tree goes down,
  `npx` wrappers included.

- **An honest gauge** (P2.8). The status strip shows how fast a reply came
  (tokens per second, the server's clock). A resumed conversation says what
  its restore saved: "context restored · 1 032 tokens in 180 ms — instead
  of ~2.1 s", the comparison drawn from the prefill speed this machine
  measured for that model, and left out until one was measured. The load
  times and prefill speeds behind every announced cost are now kept across
  launches (`measures.json` in bonaparte's data), so the first switch after
  a restart is announced with figures too. And a long prompt is no
  longer a silent wait: while the server reads it, the strip shows
  "reading 4 096 / 20 480 tokens · ~35 s left", the time extrapolated from
  this prefill's own speed once it can be measured.

- **Graphics acceleration, a setting** (P3.1, D-23). The interface still
  starts without the GPU by default — all video memory is left to the
  model — and "Engine and model" now offers Off, On, or Auto (on while the
  Browser plugin is on, for pages that need it). Chromium fixes its GPU
  mode at startup, so the choice is read from the saved config before the
  app is ready; a change shows what the restart costs (the model reloads,
  with its last measured load time, or nothing when none is loaded) and a
  "Restart now" that saves the conversation first.

- **Switch a plugin on or off** (P3.2). Each row of the hub's Plugins
  section has a switch. Off, the host tears the plugin down whole: its
  views leave the tooling panel at once, its tools leave the model's list
  (a delta, never a re-render), anything it started stops. The choice is
  remembered across launches; on, it activates again, live.

- **Undo a turn's file changes** (06 §1 D, Q-19). The safety net every
  harness has: before a tool writes a file, its original — or its absence
  — is kept in bonaparte's data (never as commits or files in your
  repository). A turn that wrote files ends with them listed and an "Undo
  these changes" button: the originals go back, a file the turn created is
  removed, a file changed again since is left as it is and named; the
  model is told, or it would believe its edits are still there. A reload
  shows the turn as undone; a deleted conversation takes its checkpoints.

- **Files joined to a message** (06 §1 B). A text file dropped on the
  composer — or picked with its paperclip — travels with the message: the
  model reads its content (in a fenced block, control tokens neutralised
  like a tool result), and the thread shows it as a chip, after a reload
  too. A file the model cannot read (an image, a binary, over 200 KB) is
  named in a notice rather than dropped in silence. The log keeps the
  message and its files apart.

- **Compaction — the conversation goes on when the context is full**
  (P2.5, D-19). When a message does not fit, or a reply is cut at the
  ceiling, a banner offers to compact; the header's menu offers it any
  time. A confirmation says what happens first. The model reads the
  conversation once more — from the cache — and writes a summary; the
  prompt restarts from a freshly frozen system prompt (the current tools,
  folders and instructions folded in), that summary and the last exchange;
  the saved context built on the old prompt is dropped. Every message
  stays on screen, the compaction marked in the thread with the summary
  behind a disclosure.

- **Keyboard shortcuts for the conversation** — Ctrl+N a new
  conversation, Ctrl+K the search, Ctrl+L the message field, Ctrl+, the
  settings — beside the flanks' Ctrl+B / Ctrl+Alt+B and the tooling's
  Ctrl+T / Ctrl+`. Settings → General lists them all.

- **A notification when a reply is ready and bonaparte is not in front**
  (06 §6) — another window on top, or waiting in the tray. A local model
  takes minutes; the notification names the conversation, and a click
  brings the window back on it. A setting turns it off.
- **Sleep unloads the model.** When the computer goes to sleep, the open
  conversation's state is saved and the model's memory freed — the same
  path as idleness, under the same setting.

- **A tool row says what the call targets** — `read_file src/a.ts`,
  `run_shell pnpm test`, `web_search llama.cpp slots` — after the tool's
  name, with the row's states and disclosure kept (apartéJS 0.17.1's
  `registerToolSummary`).

- **An approval shows the change, not just the path** (06 §2, must-have).
  Approving `edit_file src/a.ts` meant signing without seeing the edit.
  A file write now comes with its unified diff against the file on disk —
  context, the lines that go, the lines that come; a new file as added
  lines; a huge rewrite summarised; an edit that will fail (pattern absent
  or ambiguous) says so — in the approval panel's details block.
- **A question leaves with its turn.** Stopping a turn (or an error) while
  its approval was on screen left the panel open; it now goes too.

- **The project's instructions reach the model** (06 §2, must-have). The
  system prompt had a place for them and nothing filled it. Per project
  root, the first of `.bonaparte/instructions.md`, `AGENTS.md`,
  `CLAUDE.md` is read (a file made only of `@file` imports — a CLAUDE.md
  saying `@AGENTS.md` — is followed, inside its root), capped at 16 000
  characters. It is frozen into a conversation's system prompt at its
  first open; when the file changes later, the new text is appended as a
  message — the frozen prompt, and the saved context built on it, never
  move. The header's project panel says which file the model follows, or
  where it would look.

- **Pin, archive, search, duplicate, branch** (P2.7, D-43/D-44). Each
  sidebar row's menu pins (pinned conversations lead the list, whatever
  the grouping), archives (out of the list until "Show archived" in the
  Organise menu), duplicates or deletes. A search field filters titles,
  projects and models as you type. **Duplicate** — or **Branch from here**
  on any answer — creates a conversation that starts where its parent was:
  the same frozen system prompt, the log up to that turn, and a copy of
  the parent's saved context, so it resumes from the cache instead of
  computing everything again. A branch shows its parent as a mark (never
  sent to the model); the parent is untouched.

- **Saved contexts stay under a disk budget** (P2.2, D-20). A saved
  context is 100 KB a token and more — a long conversation is gigabytes —
  and nothing ever removed one. After each save, the least recently used
  others (a save or a restore is a use) are dropped until the folder fits
  a budget set in Settings (16 GB by default); the open conversation never
  goes, and one that alone exceeds the budget is reported, not deleted.
  The hub says what they take and can free the space. A dropped context
  costs a re-computation on resume, never a message.

- **A model's cost is said before it is paid** (P1.7, D-03, D-21). The
  model menus show what each model will take in memory at the engine's
  context — read from its GGUF header: the weights, the KV cache (per
  layer, counting sliding windows and linear-attention layers right), a
  compute margin — marked as an estimate, amber when tight for the
  machine, red when larger than it. Switching a conversation that has a
  history to another model (or to one that will not comfortably fit)
  first asks, with the cost: the model read from disk, the conversation
  computed again (its tokens, and seconds only when this machine measured
  that model's speed or load time), the memory it needs — and that the
  saved context stays with the current model. Cancel holds the focus.

- **Grants are kept per project, and can be taken back** (P1.8, D-29).
  An "always allow" lived in memory, for the whole app: a `pnpm` grant
  given in one project answered in every other, and a restart forgot it.
  Grants now belong to the project of the conversation that asked (a
  conversation without a project has its own bucket), are saved in
  `config/grants.json`, go with a deleted project, and are listed in a new
  **Settings → Permissions** section — grouped by project, each with what
  it covers and a Revoke button.

- **What a tool returns cannot speak as a role** (audit, C3). `/completion`
  turns special tokens in the prompt text into real ones, so a file the
  model read — or a web page, a command's output — containing
  `<|im_end|><|im_start|>system` opened a genuine system turn inside a
  tool result. Such tokens (`<|name|>` and the tool-response wrapper) are
  broken apart with a zero-width space before the log, the prompt and the
  screen see them; the model still reads the words. Applied where results
  enter the loop, so the conversations already on disk keep their bytes —
  and their saved states.

- **The bridge checks what reaches it** (audit, findings 3 and 7). Every
  IPC channel answers the app's own top frame only; the engine binary the
  renderer names must be a llama.cpp server (`llama-server`, the `llama`
  CLI or a build named after them), a remote URL http(s); a setting write
  must be a known key, in a scope it has, with a value of its type (in
  range, among its options, bounded length).

- **The managed server answers to bonaparte alone** (audit, C1/C2). It
  listened on localhost with CORS open: any web page in a browser, any
  local process could drive it — read a conversation's slot, run a
  completion. Each launch now gets a random API key, passed in the
  server's environment (never on its command line, which any process can
  list) and sent on every request; the web UI is off. And once healthy,
  the server must say it serves the model we asked for (`/props`): a
  foreign llama-server squatting the port is refused, not talked to.

- **The window is the app and nothing else** (security audit, finding 1).
  The main window carries the whole bridge to the harness, and it could
  be navigated anywhere — a link, a script that got in. It now refuses
  any navigation away from its own page; a link that opens a window
  (a reply's link) goes to the system browser, http(s) only — `file:`,
  `javascript:` and custom protocols are dropped.
- **A Content-Security-Policy on the packaged renderer** (finding 4 — the
  comment in `index.html` claimed one that did not exist). Scripts come
  from the app's files only: no inline script, no inline handler, no
  eval. Nothing is fetched from the network — which also means a remote
  image in a reply is not loaded, closing the classic exfiltration by
  image URL. The anti-flash theme script moved to a file to allow it.

- **A conversation can be deleted.** Each row of the sidebar has its own
  ⋯ menu (shown on hover or focus); "Delete…" asks first, naming the
  conversation and saying that its saved context goes with it and that
  nothing brings it back — Cancel holds the focus. The log, the meta and
  the KV state leave the disk (the audit's H2: a privacy matter, not
  tidying up). A turn streaming there is cut first; the open conversation
  lets go of the slot without saving what is being erased; deleting the
  one on screen moves to another (a fresh one when none is left).

- **One bonaparte at a time.** A second launch — a double click on the
  shortcut, the command typed twice — no longer starts a second process
  that fights the first for the server's port and writes the same
  conversations: it hands over (the running app brings its window back,
  from the tray too) and exits. Scoped by data directory, so an isolated
  profile is its own instance.

- **The shell is responsive: a window gets dragged narrow.** Above a width
  each flank is DOCKED — the resizable column beside the chat, as before.
  Below it the flank becomes a DRAWER: it leaves the flow and slides over
  the chat from its edge with a scrim behind, so the chat keeps its full
  width whatever the window size (a click on the scrim or Escape closes
  it). The sidebar undocks later than the panel — a cramped window still
  wants its conversations reachable. The window's minimum width drops from
  900 to 480 so it can actually go that narrow.

- **A tray icon, and closing keeps bonaparte waiting.** Closing the window
  sends bonaparte to the notification area (Windows/Linux) or the menu bar
  (macOS) instead of quitting — its model kept warm, a click brings the
  window back, and "Quit" from the tray is the way out. A setting ("Keep
  running when the window is closed", on by default) turns it off, so the
  X quits for good.
- **An idle model unloads itself.** After a while with no message (15
  minutes by default, a setting), the active conversation's state is saved
  and the model is unloaded — its memory freed — and the next message
  reloads it. The way LM Studio's idle TTL and Ollama's keep_alive behave.

- **A "+" on each project** in the sidebar creates a new conversation right
  in that project, not the current one.
- **The RAM chip shows bonaparte's own footprint** (the app plus the model
  server) before the machine's used/total, which the app does not control.

- **Prefix seeds: a new conversation starts from a prefix already
  computed.** Every conversation of a (model, tools, project) begins with
  the same system block, and a restored state serves as the prefix of a
  longer, different prompt — proved for real on 2026-08-28. So the first
  conversation prefills that block once (`n_predict: 0`) and saves it as a
  seed, keyed by the rendered prefix, the model and the K/V types — not
  by the context size, a seed only has to fit; every later one restores
  the seed and only prefills what is its own. The status strip says
  "prefix shared · N tokens" when that happened. The gauge counts the
  prefix from the moment the conversation opens.

- **A conversation may cap its own context.** Two settings, global and per
  conversation — "Cap the context" (off by default) and "Context cap" — so
  a conversation refuses a message once it would exceed the cap, instead of
  the server's whole context. Live: it decides what the next message may
  need, and invalidates nothing. The refusal names the limit that applied.
- **A saved state survives a larger context and a newer build.** Read in
  llama.cpp's source: a restore validates the file format, that the saved
  tokens fit, the layer count and the K/V cell types — never the model's
  identity, never that n_ctx is the same. The manifest now pins what the
  server cannot check (the model file, the cache types) and lets it judge
  the rest: a state saved under a smaller context restores into a larger
  one, a build change no longer forces a re-prefill, and a file the server
  refuses is reported as such — the conversation prefills again, announced.

- **Foundations.** pnpm + Nx workspace with enforced module boundaries; a fake
  llama-server fixture (streamed `/completion`, slot save/restore/erase, prefix
  cache) so the whole KV path is testable without a GPU.
- **llama.cpp backend**, managed (spawned, supervised, whole process tree killed
  on exit, orphan killed at startup) or remote; the unified `llama serve` CLI is
  detected alongside `llama-server`; minimum build check (b6000).
- **Per-conversation KV persistence**: slot save/restore with a strict manifest
  (model fingerprint, context size, cache types, llama.cpp build) — restore only
  on an exact match, announced re-prefill otherwise.
- **Deterministic, append-only Qwen3 prompt templating** (`PromptLog`), with a
  property test proving every rendered prompt is a strict prefix of the next.
- **Agentic loop**: Hermes `<tool_call>` parser and stream demux, tool registry
  producing a lazy grammar (`grammar_lazy` + triggers), six built-in tools
  (`read_file`, `write_file`, `edit_file`, `list_dir`, `grep_files`,
  `run_shell`), bounded turns, tool results re-injected as normal turns.
- **Permissions**: four play modes (`lecture`, `repetition`, `plume`, `impro`),
  approval dialog over IPC, remembered allow rules.
- **Projects** as named entities spanning several ordered roots; path resolution
  against the first root, confinement to the union, refusals naming the roots;
  perimeter and tool-inventory changes appended to the conversation as deltas.
- **Conversations**: append-only JSONL log, per-conversation model and
  sampling, sidebar grouped by project or flat, rename, move, delete, purge of
  legacy shapes on startup.
- **Plugin host** with a reversible contract (a plugin's registrations are torn
  down as one), declarative manifests, lazy renderer views, hot reload, and
  back-pressure by acknowledgement (VS Code's thresholds, per instance).
- **Built-in plugins**: a real terminal (xterm.js + node-pty, raw bytes, shell
  choice), a browser the agent can read (console, DOM, screenshot), a project
  launcher (package.json scripts, port detection), conversation settings.
- **Shell**: conversation header, tabbed tooling panel attached to the
  conversation, resizable and collapsible side panels (persisted), Codex-style
  top bar, settings hub with layered, schema-driven fields, status strip with a
  context gauge, model picker in the composer, temperature in the conversation.
- **Footprint**: hardware acceleration disabled (0 VRAM for the UI), private
  memory measured by an E2E test and kept under 320 MB.
- **Localisation** fr/en for the UI and the harness messages; everything sent to
  the model is English, the reply language is an explicit instruction.
- **CLI** `bonaparte doctor`: machine diagnostic (Node, llama-server, slot
  directory, disk, GPU) as a localised table with exit code.
- **CLI** `bonaparte` launches the app. The published package ships the
  built app and the built-in plugins next to the CLI and depends on
  `electron`, so `npx @aparte/bonaparte` needs nothing else; the first
  launch announces the one-time Electron download before it starts. Help
  and errors follow the locale.
- **Electron E2E** (Playwright) with a never-shown window and an isolated data
  directory.
- Plugin manifests carry their labels (name, description, tab title) in both
  locales; the UI picks the current one and falls back to English.
- **Reasoning switch** in the composer's row: whether the model thinks
  before answering, per conversation (also in the settings hub). It only
  changes the generation suffix of the next turn, so it costs nothing in
  the KV cache. Reasoning is on by default — it had been silently forced
  off for every turn.
- The composer's model menu has a search field and a head that stays
  visible while the list scrolls; the project chip of a conversation offers
  the existing projects before creating one.
- **`EngineSupervisor`** in core owns the engine's life cycle — the
  managed llama-server spawned on demand and replaced only when the model
  changes, the remote endpoint joined on demand, the pid trace that lets an
  orphan be killed at the next start, the live configuration every KV
  manifest is checked against. Tested against the fake server with a fake
  spawn; the Electron harness only wires it.
- **Web search and page reading for the model** (`web-search` plugin):
  `web_search` returns the top results of a query, `web_fetch` the readable
  text of a page. **Embedded by default**: a hidden Electron window — we are
  Chromium already — queries a public engine's server-rendered page and
  reads it; no key, no account, nothing leaves the machine but the query.
  Online providers (Brave Search, Tavily, Serper, a SearXNG instance) are in
  the plugin's settings, inactive until chosen. Both tools are read-only
  for the play modes.
- **Plugin settings reach the settings hub** — a plugin's declared settings
  show under its name in the Plugins section, and its Node half reads them
  live. They were declared, stored and never shown.
- **Stop.** The composer's button is Stop while a reply streams, and it
  now cuts the generation: what arrived stays, the turn ends, the next
  message goes through. The feature audit found the library's Stop wired
  to nothing while the engine knew how to cancel. The composer learns a
  reply is in flight from the page's message lifecycle events, which the
  screen now dispatches at the start and the end of every turn.
- **What the machine is doing, in the status strip**: CPU (all cores), RAM
  in use over the total, and on Windows the GPU's dedicated and shared
  memory with the load of its 3D and compute engines — sampled every three
  seconds by core's `ResourceMonitor`; the tooltips break the figures down
  between bonaparte's own processes and the model server. CPU and RAM come
  from Node on every platform; the GPU and the server's footprint come from
  one long-lived PowerShell child reading WDDM counters (the processor and
  memory counters are localised on a French Windows, the GPU ones are not
  — hence the split). Absent figures are absent, never guessed.
- **The project's scripts, one click away — and their page, one more.** The
  tooling panel with no tab open is a home now: every view one click away,
  and the project's `package.json` scripts, each launched and followed
  into a browser tab that opens the page the moment the server announces
  its address. The browser tab offers the same list while it shows no page;
  the launcher's "Open in the browser" opens the page inside bonaparte (the
  OS browser stays one click away). A view can now open another view with
  a payload — that is how the launcher hands a URL to the browser.
- **The conversations sidebar, redrawn**: a real "New conversation" button,
  project headings with their count, one line per conversation (its title,
  the KV badge when a state really exists) and one muted line underneath
  (model, time — the project in the flat list); the chosen conversation
  wears the kit's mark instead of a frame.
- **The apartéJS UI kit dresses every control of the shell**: buttons
  (intent × fill), fields and field groups, switches for boolean settings,
  badges in the status strip and the sidebar, alerts for notices, menus and
  popovers for the composer's mode, model and temperature pickers, the
  sidebar's organise menu, the header's project popover and the tooling
  panel's view menu, segmented tabs on the setup panel, `kbd` hints. Light
  and dark come from the `--aparte-*` tokens; the app's own stylesheet
  keeps layout and state hooks only. Every scroll area wears the chat's
  scrollbar.
- **`ConversationEngine`** in core owns the open conversation: which one
  holds the slot, its session, the turn in flight and what it produced so
  far, the state to save before the slot changes hands. Browsing is
  read-only — a reply streaming in one conversation keeps streaming while
  another is read, completes and is persisted; opening another conversation
  waits for the turn in flight and saves the first one's state; cancelling
  keeps what arrived; an explicit model choice replaces the pin (the old
  path silently kept the pinned model). The Electron harness is wired to it:
  every turn event names its conversation, the screen ignores the others,
  and a screen coming back mid-stream catches up on what the engine has so
  far. Covered by an Electron E2E against the fake server: a reply keeps
  streaming while another conversation is read, and is all there on return.
  A remote engine is joined on the first message, like a managed one is
  launched — it used to fail with "Backend not started" until the setup
  panel had been submitted once.

### Changed

- **Going online asks, in Reading and Rehearsal** (audit C5, Q-23). The
  web tools declared the `read` effect, so every mode ran them without a
  word — yet a search query or a fetched URL leaves the machine, and a
  URL can carry what the model read in a file. A new `network` effect
  says so: Reading and Rehearsal ask first (an "always allow web_search"
  per project removes the friction), Quill and Improv allow it. The mode
  menu's descriptions say it.

- **Quill asks before writing a file that runs later** (audit C6, Q-25).
  Quill lets the agent write without asking — including into
  `.git/hooks/`, `package.json` scripts, `*.config.*`, `.vscode/tasks.json`,
  CI workflows, `.husky/`, a `Makefile` or `.env`: deferred commands, or
  secrets. A write there now asks, in Quill and in Rehearsal, and a
  tool-wide "always allow edit_file" does not answer for it. Improv still
  allows it; Reading still refuses it.

- **Without a project, the tools stay in your home folder** (audit C4,
  Q-26). "No project" meant no perimeter at all — `read_file` could read
  any path on the machine, `write_file` write one. The file tools now
  work inside the home folder (relative paths start there) and refuse
  what lands outside it, telling the model to ask for a project that
  includes the folder. The system prompt of new conversations says so.

- **"Always allow" says what it covers** (audit C1, Q-24). It remembered
  the first word of a command: a grant for `pnpm test` covered
  `pnpm exec rm -rf .`. The approval panel now offers two scopes, each
  with a second line saying what it means — *this command* (the exact
  line) and *every `pnpm` command* (offered only when the program is a
  plain name; never a command chained with `; & |` or redirected). A tool
  without a command keeps a single "always allow edit_file".

- **apartéJS bumped to 0.17.2** (from 0.16.2, in lockstep — twelve releases,
  changelogs read line by line). The 0.17 breaking changes miss us: we
  build no `AparteChatMessage[]` (the tool roles), register no composer
  action, use neither `<aparte-conversation-list>` nor `AparteFilePart`,
  and none of the removed CSS classes. What changes: the React wrapper now
  renders `<aparte-elicitation>` itself, so our hand-mounted presenter is
  gone; and the kit follows the OS colour scheme since 0.16.7, which broke
  our dark palette on a dark OS (below, and apartejs/aparte#95).

- **apartéJS bumped to 0.16.2** (from 0.16.1, in lockstep). No code change
  on our side, and the headline fix lands right where our responsive shell
  needed it: moving `<aparte-chat>` in the DOM no longer disconnects the
  composer — the child elements now bind their listeners in
  `connectedCallback` instead of `_render()`, so a reparent survives (our
  flanks reflow around the chat, and a future split-pane would move it
  outright). In prime: the scroll-to-bottom button floats a steady 16px above
  the transcript in framework-managed mode (it used to drift 48–278px with the
  spacer), empty transcripts stop showing a scrollbar, and a new opt-in
  `overlay-composer` we don't use yet. Typecheck, lint, build, and 29/29 E2E
  green on 0.16.2.

- **apartéJS bumped to 0.16.1** (from 0.15.1, in lockstep). No code change
  on our side. What we get: a fenced code block from the model now wraps
  instead of being silently amputated (`@aparte/plugin-marked`); a link in a
  reply can no longer choose its own `target`/`rel` — it opens a new tab with
  `noopener` — and model markup can no longer wear an `aparte-*` class to
  forge core UI (the two security fixes we filed as issues #38 and, for the
  approval panel, #37, both shipped in 0.16.0); the composer keeps the
  transcript's gutter on a narrow pane; scrolling up during a streaming
  reply works on WebKit; a failed tool call settles on a `failed` status
  instead of spinning. 451 unit tests (the token and contract specs
  included), lint, build and 29/29 E2E green on 0.16.1.

- **The settings read as a list, and a field can depend on another.** Every
  row is one line now — label on the start edge, control (switch, select,
  field) on the end — so a plugin's settings and the sampling panel line up
  the same way. The "advanced settings" toggle sits ABOVE the fields it
  reveals, not below them. A field can declare `showFor` (shown only when a
  sibling holds a given value) and `secret` (masked): the web search shows
  its API key only once an online provider is chosen, and masks it.

- **Tailwind CSS 4 and shadcn/ui dress bonaparte's own controls** — the
  settings hub and the shared settings form, then the shell: the sidebar
  (its organise menu is a real menu — radio items, keyboard, Escape), the
  conversation header (the project panel is a popover that closes on Escape,
  the actions a menu), the status strip (badges, the context gauge on a
  progress bar), the project dialog (a dialog: overlay, focus trap, Escape),
  then the composer's row: the play mode is a menu of radio items, the
  reasoning switch a pressed toggle, the temperature a popover with a real
  slider (keyboard, Escape), the model a popover with its search; then the
  first screens — connecting the engine (a card, segmented tabs, the URL
  field with its Check button in one group, the verdict as an alert) and
  choosing the model (a real radio group, the search with its clear
  button); and the tooling panel — its tab strip, its "open a view" menu
  (a real menu in a portal, so the collapsing bar no longer clips it), its
  home — with the three plugin views (launcher, browser, terminal) on the
  same primitives: one library for the app and its plugins, as intended.
  At the end of it, `app.css` is gone — 1 656 lines of hand-rolled rules
  replaced by utilities on the elements; what remains is the palette
  (`theme.css`), Tailwind's entry with the element-level defaults in its
  `base` layer (`index.css`), the flank mechanics (`layout.css`) and
  xterm's height chain (`terminal.css`). The primitives (button, input, select, switch, menu,
  popover, tabs, dialog, tooltip…) live in `@aparte/bonaparte-plugin-sdk/ui`:
  one component library for the app and every plugin view, materialised
  from shadcn's registry as source, the way shadcn intends. The palette is
  declared once, as shadcn's semantic variables, and bridged to the chat's
  `--aparte-*` tokens — the aparté chat, composer and elicitation panel
  stay: bonaparte exists to prove the library. Tailwind's layers make the
  migration safe: the kit's and our remaining rules are unlayered and keep
  winning, our element-level defaults moved to the `base` layer and skip
  every `[data-slot]` control.
- **A plugin setting can declare its default** (`default` in
  `configSchemas`), so the hub shows the value in force instead of an empty
  choice while the plugin's Node half applies its own fallback. The web
  search provider says "Embedded".

- **bonaparte wears React's colours.** The default palette is no longer
  apartéJS's brass: the accent is react.dev's own blue (blue-50 in light,
  blue-30 in dark) and the greys are their gray scale, declared on the kit's
  `--aparte-*` masters in `theme.css` for both themes — the kit derives
  the inks. One product per framework, each in its framework's colour. The
  window's pre-paint background and the terminal's fallbacks follow.

- The system prompt is laid out from the most stable block to the most
  volatile: identity and tool-call convention, then the tool inventory, then
  the perimeter, reply language and project instructions of the conversation.
  The order is baked into every saved KV state; the previous one put the
  per-conversation perimeter before the shared inventory. Conversations
  created before keep their frozen prompt and their saved state.
- **The context is finite, and said so.** A message that cannot fit in the
  server's context — with room for a reply — is refused before anything is
  persisted or sent, and announced in the thread with the numbers; a prompt
  the server itself refuses as too long is announced the same way, never as
  a raw HTTP error. The managed server is launched with context shift OFF
  (a test guards it): the head of the prompt is never dropped behind our
  back, because every saved KV state depends on it. The context gauge now
  reads what the slot really holds after a turn — prompt and reply — and,
  at open, what a restored state brought back.
- **A tool call asks for consent on apartéJS's approval panel**, inline in
  the composer where the answer is typed — the same panel the library uses
  for its own approvals — instead of a modal of bonaparte's own. The three
  options (allow, always allow, refuse) are bonaparte's, because only the
  harness knows it can remember a grant; the question is asked in the
  conversation whose turn is waiting, and only there. Covered by an
  Electron E2E against the fake server (a tool call, a refusal, the next
  turn).
- The OpenAI-compatible backend and endpoint detection were removed
  (2026-08-19): bonaparte drives llama.cpp only, because no OpenAI façade
  exposes the state it persists.
- **The context size, the KV cache quantization and the GPU layers belong
  to the engine**, set once in Settings, not to a conversation: two
  conversations on one model share one server instead of restarting it,
  and changing one of these settings stops the server (its state saved
  first) so the next message brings it up with the new values. The model
  picker no longer asks for a context size; the context gauge reads what
  the server holds. A state saved under another context size is refused by
  its manifest and announced as a re-prefill.
- apartéJS 0.2 → 0.15.1: the library is consumed in lockstep; each bump is
  checked against a friction journal and contract tests on the rules the chat
  loop depends on. With 0.14.0 the highlighting provider takes a light/dark
  pair, so code blocks follow the theme switch without re-registration; with
  0.15.0 a tool call's input and result wrap inside the bubble instead of
  running past its edge.

### Fixed

- **The strip said "engine not connected" while the engine ran.** Browsing
  a conversation reads its log without touching the engine, and the chip
  kept that status after the first message opened it. The open now reports
  what it found (restore, cold start or shared prefix); a browsed
  conversation reads "resumes on send" while the engine runs, and "context
  kept", with its gauge, when the slot still holds it.

- **`edit_file` writes `new_string` literally.** It used
  `String.replace(old, new)`, which expands `$&`, `` $` ``, `$'` and `$$`
  in the replacement: a shell script, a regex or a PHP variable written by
  the model came out mangled.

- **Numbers follow the interface's language**, not the operating
  system's: the temperature's decimal separator and the token counts read
  `8,192` in English on a French Windows.

- **Picking a model no longer erases the config.** The full-screen model
  picker saved `{ backend, defaultModel }` as the WHOLE config: settings,
  language, play mode, recent folders and the current conversation were
  dropped. The renderer can no longer write the config whole at all —
  only the default model and the language, each checked; the engine config
  is saved by the harness once the engine starts. (Two whole-config writers
  racing each other also lost updates.)

- **A turn waiting for an approval no longer hangs a Stop.** The loop
  awaited the answer to an approval without listening to the turn's abort
  signal: a Stop, a settings change or a deletion while the question was
  on screen left the turn — and everything that waits for it, the next
  open, the next save — hanging until someone clicked. An abort now counts
  as a refusal.

- **The dark theme stays React's on a dark OS.** Since apartéJS 0.16.7 the
  kit declares its own dark palette under `prefers-color-scheme: dark` as
  `:root:not([data-aparte-theme=light])`, which outranks a bare
  `[data-aparte-theme="dark"]`: on a Windows in dark mode the chat went
  back to brass and plum while the shell stayed blue. The dark block is
  now `:root[data-aparte-theme="dark"]`; an E2E emulates the dark OS.

- **A reply cut at the context ceiling now says so.** On a resumed, deep
  conversation the model "kept stopping before the end": the server cuts
  the generation when the context fills up (`--no-context-shift`,
  `slot.truncated`), and any stop was read as a clean finish — a silently
  short answer. The turn now carries that it was cut, and the thread shows
  "the reply was cut short: the context is full", pointing at a new
  conversation or a higher context cap.

- **Three findings of the security audit, fixed the same evening.** A rule
  "always allow `pnpm test`" also allowed `pnpm test && curl … | sh`: the
  word boundary stopped `pnpm testament` but let every shell operator
  through behind a space — a command with a shell operator (semicolon,
  ampersand, pipe, redirection, dollar, backtick or a line break) after
  the prefix is another command, and asks again. Forgetting a conversation
  removed its slot file by bare name, resolved from the process's working
  directory, and never found it: the state is now deleted from the store.
  The project launcher ran a script by name through the Windows shell
  without checking the name: a script named `dev & …` in a cloned
  package.json would have run its tail on the first click — names that are
  not plain tokens are refused, and not offered.

- Switching conversation from the sidebar left the previous thread on
  screen: the chat screen is now remounted per conversation. Covered by an
  Electron E2E.
- A replayed assistant turn derived its generation suffix from whether the
  model had produced reasoning, not from the choice made when the turn was
  generated: with reasoning on and a model that answered without thinking,
  the replay inserted an empty think block the live turn never had, and the
  KV prefix broke there. The choice is now recorded with the turn.
- Highlighted code inside the chat (tool inputs and outputs) sat on
  GitHub's palette, inlined by shiki; its surface follows the aparté theme
  tokens now.
- Two messages sent while a reply was still streaming ran two turns at once
  on the one slot and corrupted the conversation log; a session now runs
  one turn at a time, the next message queues behind the one in flight.
- The last user-visible strings that bypassed the translations follow the
  locale now: the settings catalog, the doctor's details, the native file
  pickers' filter names, the model pickers' size units, the CLI's help. A
  new conversation is stored untitled and named by the interface in its own
  language, until its first message names it.
- The renderer guessed its language from the browser and overwrote the
  stored choice at every start; a locale set in the configuration now wins,
  and the detection is written there only when nothing was set.
- Launched from its built entry (`electron out/main/index.js`, what the
  Electron E2E does), the app looked for the built-in plugins next to the
  entry and found none — the tooling panel offered no view in every E2E.
  The resolver walks up to the repository's `plugins/` from the entry as
  well; an E2E asserts the four plugins are discovered.
- A cancelled turn threw away the text that had arrived; the loop now
  commits it as the assistant's turn — it is what the server's KV cache
  holds — and ends the turn without running tool calls parsed before the
  cut.
- The managed server's pid trace outlived a clean shutdown (Electron quits
  before the child's exit event fires): it is erased when the server is
  stopped.
- Quitting with a reply still streaming — or a tool call waiting for a
  consent nobody would give — hung the shutdown on the turn: the turn is
  cut, what arrived is committed, the state is saved, pending approvals are
  answered with a refusal.
- A conversation reads back the way it was seen: the tool calls of
  earlier turns, their outcome and the reasoning were dropped when a
  conversation reopened — the reader kept the text alone, by design. An
  assistant turn now comes back with its segments, settled.
- At startup the tooling did not know the conversation's project until
  the first navigation: the launcher said "open a folder" for a
  conversation that had one.
- Stopping a project script killed its shell and left the dev server it
  had started running — and listening — behind; the whole tree goes down.
- An isolated data directory (`BONAPARTE_DATA_DIR`) now isolates Electron's
  own storage too: a conversation's tooling tabs, kept in localStorage,
  leaked across profiles and across E2E runs sharing a conversation id.
- On a fresh install the very first message got no reply on screen: the
  screen had been mounted before any conversation existed and ignored the
  events of the one the message created. A conversation exists from the
  start now — empty, loading nothing. Every other E2E started with a
  conversation and hid this; one starts from nothing now. The sidebar also
  learns a conversation's name — its first message — when the turn ends,
  not on the next navigation.
- The context gauge was blind since the loop refactor: the harness
  forwarded a turn's end without its counts. It carries the prompt size, the
  cached part, the reply size and the slot's total again.
- The context gauge reported zero cached prompt tokens on every real turn:
  llama-server puts `prompt_progress` in intermediate stream events and the
  authoritative count in the final event's `timings.cache_n`, while the
  client read the progress from the final event only. The fake server now
  mirrors the real shape, and the client reads both places.
- A conversation pinned to a model whose file had been deleted failed at
  send time, after a doomed engine launch, with "No model chosen for this
  conversation." The vanished file is now announced when the conversation
  opens (a banner in the thread, with a button to the picker), and a message
  sent anyway leads to the picker, which names the file; the message is
  sent once the new model is ready. The check happens before any launch.
  Covered by an Electron E2E.

### Known limitations

- The agentic path beyond the first tool call, the KV prefix surviving a
  tool round-trip, and a restored state serving as the prefix of a branch
  are covered by a real-model smoke test (five cases, green on Qwen3-1.7B on
  2026-08-28) that is not part of CI.
- Nothing is published on npm yet.
- Third-party plugins outside the repository are not loadable.
- `n_ctx` is still pinned per conversation; retention of saved states, prefix
  seeds, compaction and the VRAM budget are not implemented.
