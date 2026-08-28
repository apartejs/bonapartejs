# Contributing to bonaparte

Thanks for your interest! bonaparte is pre-alpha and the surface moves fast.
This guide covers how work lands.

## Principles

1. **Think before coding.** A three-line plan — problem, approach, what changes
   and what doesn't — beats diving in.
2. **Test first.** Everything that touches the backend is written against the
   fake llama-server (`packages/core/src/testing/fake-llama-server.ts`); no test
   needs a GPU or a model.
3. **Surgical changes.** One concern per commit, no drive-by refactors.
4. **Nothing expensive without announcing it.** That is the product rule, and it
   applies to code review too: a change that costs the user a model reload or a
   re-prefill says so in the pull request.

## Reporting bugs and proposing features

- **Bug**: open an issue with the template — OS, GPU and VRAM, llama.cpp build,
  model, and what you did. The app's diagnostic (`bonaparte doctor`) and the
  main-process log are the fastest way to a fix.
- **Feature**: describe the problem before the shape. Two boundaries decide a lot
  up front: bonaparte drives **llama.cpp only** (no OpenAI-compatible backends —
  none exposes the state we persist), and it is **not a model manager**.
- **Security**: never as a public issue — see [SECURITY.md](./SECURITY.md).
- Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Setup

```sh
pnpm install
pnpm build
pnpm test
```

Requires the pnpm version pinned in `package.json` (`packageManager`) and Node
20+ (24 recommended, see `.nvmrc`). Native modules (`node-pty`) build during
install; on Windows that needs the Visual Studio Build Tools and Python.

## The gate

Every change lands behind a green gate:

```sh
pnpm lint        # eslint + Nx module boundaries
pnpm typecheck
pnpm build
pnpm test        # unit suites, seconds, no GPU
pnpm --filter @aparte/bonaparte-app test:e2e   # Electron E2E, after a build
```

CI runs the same on Ubuntu and Windows. The real-model smoke test
(`packages/core/src/smoke`) is **not** part of the gate — it needs a GPU and a
GGUF — but anything touching grammars, slots or the prompt log should be replayed
against it before it lands; the maintainer does, and records the result.

## The invariants

These are enforced by tests or lint, and a pull request that weakens one will
not be merged. They are explained in [AGENTS.md](./AGENTS.md).

- **The prompt is append-only.** A frozen history is never re-rendered; a change
  of tools or project is a delta appended to the log.
- **`/completion` only.** Never `/v1/chat/completions`.
- **Strict restore.** A KV state is restored only when its manifest matches
  exactly; on any doubt, re-prefill, announced.
- **`packages/core` never imports `electron`.** The lint boundary enforces it.
- **The renderer never talks to llama-server**, and there is no `AparteClient`
  in the renderer — the chat is driven over IPC.
- **A plugin never undoes its registrations by hand.** Everything goes through
  its context, which the host tears down as one.
- **Everything sent to the model is English.** The UI is localised (fr/en, both
  files updated together); the wire protocol is not.

## Commits

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:` …), one
  concern each, with a body that says **why** — the history is the project's
  memory.
- **English is the language of the repository**: code, comments, commit
  messages, documentation, plugin manifests. UI strings are localised (fr/en)
  through the i18n files, never hard-coded in one language.
- Never commit `dist/`, `out/`, `*.tsbuildinfo`, `.claude/` or
  `docs/superpowers/` — they are ignored; stage explicit files.

## Writing a plugin

Built-in plugins live under `plugins/*`: a declarative `plugin.json`, an
optional Node half (`src/node.ts`, built with tsup) and a renderer half
(`renderer.tsx`, bundled with the app). The authoring surface is
`@aparte/bonaparte-plugin-sdk`. Third-party plugins outside the tree are not
loadable yet — that is a v1.x item, deliberately.

## Anti-patterns

- No `electron` import in `packages/core`, ever.
- No re-rendering of the frozen prompt to "fix" something — append a delta.
- No silent cost: no model reload, re-prefill or eviction without a message.
- No ANSI filtering in the terminal plugin — xterm.js is the emulator.
- No UI string without both `fr` and `en`; no English-only UI, no French on the
  wire.
