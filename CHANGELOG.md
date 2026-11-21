# Changelog

All notable changes to bonaparte are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Every `@aparte/bonaparte*` package
ships at one version.

## [0.1.0] - 2026-11-21

The first version, restarted from zero on apartéJS 1.7 and built on 1.16:
Windows, installed from the repository's releases.

### Added

- **The built-in engine**: the official llama.cpp, found on the machine or
  downloaded and verified by the app (its Vulkan build, with the Visual C++
  runtime it needs carried by the installer), launched hidden on the loopback
  with a key of its own; the GGUF models found on the disk, each with what
  loading it costs (time, video memory) before anything is loaded, the
  context chosen to fit the card; a short list of recommended models (Gemma 4,
  Qwen 3), downloaded on a click and verified. Gemma 4 and Qwen 3 are rendered
  as their own templates render them.
- **A memory per conversation**: its KV state saved and restored under a disk
  budget, a shared seed for a fresh conversation, a journal per conversation
  that stays the truth when a memory is let go; every restore and re-read
  announced with its cost.
- **The agent**: one tool registry and one approval policy — read, list,
  search, edit, write, run a program, fetch a page, plan, ask; four modes
  (Lecture, Répétition, Plume, Impro); files that run later always asked; a
  pause for approval that survives a restart.
- **The work on the code**: projects, the files, the changes with their diff
  and comments on the lines, a terminal per tab, a conversation on a git branch
  of its own with its pull request and CI; a conversation moved to another
  project.
- **Going back, branches and compaction**: back before a message (the code,
  the conversation, or both), every branch kept, a compaction that is a rebase
  of the prompt — asked, or made by the engine itself before the context runs
  out — and a change of model said before it is paid.
- **Sub-agents**, in turn on the conversation's slot, in parallel on two, or
  on a service; « À traiter », the notifications and the notification area.
- **Services**: Ollama, LM Studio, a llama-server already running, or an
  OpenAI-compatible API, with the same tools and approvals; discussions without
  a project; a first launch that offers the built-in engine or a service.
- **The browser, the web search and MCP servers**, each judged like every tool.
- **Plugins**: added from a folder, npm or git, each in a process of its own
  and its view in a sandboxed frame; a plugin written by the agent in a
  conversation, tried there, then installed.
- **The finishing**: shortcuts, the mascot, the window's own title bar, a card
  for each failure, a conversation's own settings, the resource monitor.
- **Distribution**: a per-user Windows installer, built and published as a
  draft release by a tag; « Mises à jour » for llama.cpp and the models, each
  saying its cost first, none installed while a conversation is working;
  `bonaparte doctor`.

### Known limits

- **Not signed.** SmartScreen warns at the first install (« More info », then
  « Run anyway »); Smart App Control, when it is on, blocks the app outright.
- **The app does not update itself while the repository is private**: its
  releases cannot be read without a token, and the app carries none.
  « Mises à jour » says so; a new version is installed from the releases by
  hand.
- **`npx @aparte/bonaparte` is not published** on npm yet.
- **macOS and Linux** are built only on request, not signed and not tested.
- Llama, Mistral and gpt-oss models are not rendered by the built-in engine
  yet (Gemma 4 and Qwen 3 are); a service runs them.

### Changed

- **Restart from zero.** The first implementation (v0, built between
  2026-08-18 and 2026-09-26, never published) is archived on the `archive/v0`
  branch. The new one starts from a design made first.
