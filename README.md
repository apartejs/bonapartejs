# ('.') bonaparte

**A local-first coding agent, for developers who run their models on their own
machine.** An Electron desktop app built on [apartéJS](https://apartejs.dev),
driving a managed `llama-server` (llama.cpp) — and remembering the inference
state of every conversation.

[![CI](https://github.com/apartejs/bonapartejs/actions/workflows/ci.yml/badge.svg)](https://github.com/apartejs/bonapartejs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Status: pre-alpha, under active development.** Nothing is published on npm
> yet, and the app is not ready for daily use. The road to v1 is at the bottom
> of this page; what changed when is in [CHANGELOG.md](./CHANGELOG.md).

## Why

Every coding agent out there is cloud-first. That is fine against an API that
caches prompts server-side; it is a tax on a local model. Resuming a long
conversation means re-processing its entire context — minutes to an hour of
prefill on a large prompt, every time you come back.

bonaparte saves and restores the **KV cache per conversation** through
llama-server's slots. Closing a 30 000-token conversation and reopening it
tomorrow costs seconds of disk I/O, not minutes of GPU time.

One rule drives every screen: **nothing expensive happens without being
announced first.** The VRAM a configuration needs before the model loads, the
reload a model switch costs before you switch, the re-prefill a stale state
implies before it is paid.

## What it is — and is not

- It **is** a coding agent: file tools (read, write, edit, list, grep) and a
  bounded shell, tool calls constrained by grammar, four permission modes
  (`lecture` read-only · `repetition` ask for everything · `plume` auto-edits,
  commands ask · `impro` everything passes), projects spanning several folders,
  and built-in plugins — a real terminal, a browser the agent can read, a
  project launcher, conversation settings.
- It **is** an embedded runner: it starts, configures, supervises and stops
  `llama-server` for you. No LM Studio or Ollama needed to run a GGUF.
- It is **not** a model manager. Bring your own GGUF (the Qwen family is the
  tested reference); catalogues and downloads are what LM Studio does better.
- It only drives **llama.cpp**. It is not an OpenAI-compatible client, on
  purpose: no OpenAI façade exposes the state we persist.

## How it works, briefly

- The prompt is templated **client-side, deterministically, append-only**. The
  server's raw `/completion` endpoint gets text; `/v1/chat/completions` is never
  used, because Qwen3's chat template is not byte-stable across turns and would
  defeat every prefix cache.
- Tool calls use llama.cpp's **lazy grammar**: the model is constrained only
  once it opens a `<tool_call>` block, never forced to call a tool.
- A saved KV state carries a **manifest** — model fingerprint, context size,
  cache types, llama.cpp build. It is restored only on an exact match; otherwise
  the re-prefill is announced, never silently paid.
- Tool inventory and project changes are **appended** as service messages. The
  frozen prefix is never re-rendered.

## Requirements

- Node.js 20+ (24 recommended) and pnpm — `corepack enable` picks the pinned
  version.
- A llama.cpp `llama-server` build **≥ b6000**, on your PATH or configured in
  the app. The unified `llama` CLI (`llama serve`) works too.
- One or more GGUF models.
- Windows is the primary platform today; macOS and Linux are best-effort.

## Getting started (from source)

```sh
pnpm install
pnpm dev                                        # the Electron app
pnpm test                                       # unit suite — no GPU, no model
pnpm build
pnpm --filter @aparte/bonaparte-app test:e2e    # Electron E2E, after a build
node packages/cli/dist/cli.js doctor            # machine diagnostic
```

What the fake server cannot prove — lazy grammars, a real model emitting tool
calls, the KV prefix surviving a tool round-trip — has a real-model smoke test:
`BONAPARTE_SMOKE_MODEL=<path.gguf> npx vitest run src/smoke` in `packages/core`.

## Workspace

pnpm workspaces + Nx (task cache, enforced module boundaries).

| Package | Role |
| --- | --- |
| `packages/core` | `@aparte/bonaparte-core` — the harness: llama.cpp backend, KV persistence, prompt log, tools, permissions, agent loop, plugin host. Pure Node, no Electron. |
| `packages/shared` | `@aparte/bonaparte-shared` — IPC contract, DTOs, plugin manifest schema. |
| `packages/plugin-sdk` | `@aparte/bonaparte-plugin-sdk` — what a plugin author imports. |
| `packages/cli` | `@aparte/bonaparte` — `bonaparte doctor` today; `npx @aparte/bonaparte` will launch the app. |
| `packages/app` | The Electron app: main process, typed preload, React renderer. |
| `plugins/*` | Built-in plugins: `terminal`, `browser`, `project-launcher`, `conversation-settings`. |

## Road to v1

- [x] Foundations — KV save/restore proven on a real model
- [x] Agentic loop, grammar-constrained tool calls, permissions, projects
- [x] Plugin-first shell, four built-in plugins, settings hub
- [ ] Conversation engine — state that survives navigation, engine-owned launch settings, overflow guard
- [ ] The differentiator, complete — retention budget, prefix seeds, compaction, VRAM budget, branching
- [ ] Composable layout, per-plugin activation
- [ ] MCP client
- [ ] `npx @aparte/bonaparte`, llama.cpp downloader, first release
- [ ] Landing page and documentation site (Astro + Starlight), with a reference generated from the code

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). bonaparte is also the proving ground
of apartéJS: friction with the library is fed back upstream rather than worked
around in silence.

Security issues: [SECURITY.md](./SECURITY.md) — never as a public issue.
Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © 2026 Paul Richez
