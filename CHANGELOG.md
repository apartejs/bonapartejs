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

- The system prompt is laid out from the most stable block to the most
  volatile: identity and tool-call convention, then the tool inventory, then
  the perimeter, reply language and project instructions of the conversation.
  The order is baked into every saved KV state; the previous one put the
  per-conversation perimeter before the shared inventory. Conversations
  created before keep their frozen prompt and their saved state.
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
- apartéJS 0.2 → 0.15: the library is consumed in lockstep; each bump is
  checked against a friction journal and contract tests on the rules the chat
  loop depends on. With 0.14.0 the highlighting provider takes a light/dark
  pair, so code blocks follow the theme switch without re-registration; with
  0.15.0 a tool call's input and result wrap inside the bubble instead of
  running past its edge.

### Fixed

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
