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
- **Electron E2E** (Playwright) with a never-shown window and an isolated data
  directory.
- Plugin manifests carry their labels (name, description, tab title) in both
  locales; the UI picks the current one and falls back to English.

### Changed

- The system prompt is laid out from the most stable block to the most
  volatile: identity and tool-call convention, then the tool inventory, then
  the perimeter, reply language and project instructions of the conversation.
  The order is baked into every saved KV state; the previous one put the
  per-conversation perimeter before the shared inventory. Conversations
  created before keep their frozen prompt and their saved state.
- The OpenAI-compatible backend and endpoint detection were removed
  (2026-08-19): bonaparte drives llama.cpp only, because no OpenAI façade
  exposes the state it persists.
- apartéJS 0.2 → 0.13: the library is consumed in lockstep; each bump is
  checked against a friction journal and contract tests on the rules the chat
  loop depends on.

### Known limitations

- The agentic path beyond the first tool call, and the KV prefix surviving a
  tool round-trip, are covered by a real-model smoke test that is not part of CI.
- The CLI cannot launch the app yet; nothing is published on npm.
- Third-party plugins outside the repository are not loadable.
- `n_ctx` is still pinned per conversation; retention of saved states, prefix
  seeds, compaction and the VRAM budget are not implemented.
