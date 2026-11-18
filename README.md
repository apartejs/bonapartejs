# ('.') bonaparte

**A local-first coding agent, for developers who run their models on their own
machine.** A desktop app built on [apartéJS](https://apartejs.dev), driving the
official llama.cpp server itself and remembering the inference state (KV cache)
of every conversation.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## Why

Most coding agents are built for cloud APIs. That is fine against an API that
caches prompts server-side; it is a tax on a local model. Resuming a long
conversation means re-processing its entire context, every time you come back.

bonaparte saves and restores the **KV cache per conversation** through
llama-server's slots: reopening a long conversation tomorrow costs seconds of
disk I/O, not minutes of GPU time.

## What sets it apart

- **Each conversation keeps its memory.** Its KV state is saved when it leaves
  the engine and restored when it comes back, under a disk budget you set. A
  fresh conversation starts from a shared, pre-read seed.
- **Every cost is announced before it is paid**: a model load and the video
  memory it takes, a conversation to read again, an eviction, a restart, a
  download, an update. Nothing expensive happens in silence.
- **The memory serves the work.** Going back before a message, branching, a
  sub-agent borrowing the slot, a compaction: each reuses what the engine
  already holds, and says what it will read again when it cannot.
- **The official llama.cpp, managed by the app.** bonaparte finds your GGUF
  models, says whether one fits your card, downloads a verified llama.cpp build
  if you have none, and launches it hidden, on the loopback, with a key of its
  own. Gemma 4 and Qwen 3 are rendered as their own templates render them.
- **A coding agent, with its approvals.** It reads, searches, edits, runs
  commands, browses and plans in your project; four modes decide what passes
  and what is asked, and files that run later (`package.json`, git hooks,
  `.env`…) are always asked. A conversation may work on a git branch of its
  own, with its pull request.
- **Not only the built-in engine.** Ollama, LM Studio, a llama-server already
  running, or any OpenAI-compatible API: a conversation runs there with the same
  tools and the same approvals, and says what it loses (the memory).

## Install

**The installer** (Windows; macOS and Linux at best): download
`bonaparte-setup-<version>.exe` from the
[releases](https://github.com/apartejs/bonapartejs/releases). It installs for
your user only, and keeps itself up to date — each update says what it costs
before it is installed, and none installs while a conversation is working. The
installer is not signed yet: Windows warns the first time.

**From npm**, for developers:

```sh
npx @aparte/bonaparte          # launches the app (Electron is downloaded once, about 110 MB)
npx @aparte/bonaparte doctor   # says what this machine has for the built-in engine
```

## What it needs

- **Windows 10 or 11, 64-bit** (macOS and Linux at best).
- **For the built-in engine**: a graphics card llama.cpp can use through Vulkan
  (Metal on a Mac), with enough video memory for the model you choose — the app
  says it before anything is loaded, and offers a part on the processor, slower,
  when a model is too big. The recommended models go from a small one for any
  card to larger ones from 8, 12, 16, 24 and 32 GB of video memory.
- **Disk**: the model itself, and room for the conversations' memory (a few
  hundred MB to a few GB each for a long one; the budget is yours to set).
- **Node 24 or newer**, only to run it with `npx`.

Without a card, connect a service (Ollama, LM Studio, an API) instead.

## Contributing

bonaparte is the proving ground of apartéJS: friction with the library is fed
back upstream rather than worked around in silence. How work lands:
[CONTRIBUTING.md](./CONTRIBUTING.md). Security issues:
[SECURITY.md](./SECURITY.md), never as a public issue. Conduct:
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

Built with agents: see [AGENTS.md](./AGENTS.md) for the rules they follow, and
`.claude/` for their configuration.

## License

[MIT](./LICENSE) © 2026 Paul Richez
