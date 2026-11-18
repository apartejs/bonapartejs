# Changelog

All notable changes to bonaparte are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Every `@aparte/bonaparte*` package
ships at one version.

## [1.0.0] - Unreleased

The first version, restarted from zero on apartéJS 1.7 and built on 1.13.

### Added

- **The built-in engine**: the official llama.cpp, found on the machine or
  downloaded and verified by the app, launched hidden on the loopback with a
  key of its own; the GGUF models found on the disk, each with what loading it
  costs (time, video memory) before anything is loaded; a short list of
  recommended models (Gemma 4, Qwen 3), downloaded on a click and verified.
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
  of its own with its pull request and CI.
- **Going back, branches and compaction**: back before a message (the code,
  the conversation, or both), every branch kept, a compaction that is a rebase
  of the prompt, a change of model said before it is paid.
- **Sub-agents**, in turn on the conversation's slot or in parallel on two;
  « À traiter », the notifications and the notification area.
- **Services**: Ollama, LM Studio, a llama-server already running, or an
  OpenAI-compatible API, with the same tools and approvals; discussions without
  a project; a first launch that offers the built-in engine or a service.
- **The browser, the web search and MCP servers**, each judged like every tool.
- **Plugins**: added from a folder, npm or git, each in a process of its own
  and its view in a sandboxed frame; a plugin written by the agent in a
  conversation, tried there, then installed.
- **The finishing**: shortcuts, the mascot, a card for each failure, a
  conversation's own settings, the resource monitor.
- **Distribution**: a per-user installer that updates itself — each update
  (the app, llama.cpp, a model) saying its cost first, none installed while a
  conversation is working; `npx @aparte/bonaparte` to launch the app, and
  `bonaparte doctor`.

### Changed

- **Restart from zero.** The first implementation (v0, built between
  2026-08-18 and 2026-09-26, never published) is archived on the `archive/v0`
  branch. The new one starts from a design made first.
