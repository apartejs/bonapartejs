# ('.') bonaparte

**Local-first coding agent.** An Electron desktop client for developers running
their models locally — built on [apartéJS](https://apartejs.dev), powered by a
managed `llama-server` (llama.cpp).

What makes it different: **per-conversation KV-cache persistence**. Resuming a
long conversation on a local model normally means re-processing the entire
context (minutes to hours on large prompts). bonaparte saves and restores the
inference state per conversation — resuming takes seconds.

> Status: early development. Not ready for use yet.

## Workspace

pnpm workspaces + Nx (task cache, module boundaries).

| Package | Role |
| --- | --- |
| `packages/core` | `@aparte/bonaparte-core` — the harness: pure Node, no Electron |
| `packages/shared` | `@aparte/bonaparte-shared` — shared types & schemas |
| `packages/cli` | `@aparte/bonaparte` — `npx @aparte/bonaparte` (doctor, launcher) |
| `packages/app` | Electron app (main + preload + React renderer) |
| `plugins/*` | Built-in plugins (browser, terminal, …) |

```sh
pnpm install
pnpm dev        # launch the Electron app
pnpm test       # run all tests
pnpm build      # build all packages
```
