# Changelog

All notable changes to bonaparte are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Every `@aparte/bonaparte*` package
ships at one version.

Until the first release, this file is written by hand from the commit history;
changesets take over at 0.1.0.

## [Unreleased]

Everything below was built between 2026-08-18 and 2026-08-28 and has not been
published.

### Added

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
