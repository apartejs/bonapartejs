# Contributing to bonaparte

Thanks for your interest! bonaparte restarted from zero in November 2026 and
is pre-alpha: the surface moves fast. This guide covers how work lands. The
rules themselves, with their reasons, are in [AGENTS.md](./AGENTS.md).

## Principles

1. **Think before coding.** A three-line plan — problem, approach, what changes
   and what doesn't — beats diving in.
2. **Test first.** A red test, then the minimal implementation. Everything that
   touches the engine is written against the fake llama-server: no test needs
   a GPU or a model.
3. **Surgical changes.** One concern per commit, no drive-by refactors.
4. **Nothing expensive without announcing it.** That is the product rule, and
   it applies to code review too: a change that costs the user a model load, a
   re-read or a restart says so in the pull request.
5. **The interface follows its design.** Screens are built from a design
   canvas and compared with it. Propose the change of design before the code.
6. **aparté for every control.** bonaparte is the proving ground of
   [apartéJS](https://apartejs.dev): no second UI library. What the library
   lacks, or gets wrong, is an issue on
   [apartejs/aparte](https://github.com/apartejs/aparte/issues), filed when it
   happens, never worked around in silence.

## Reporting bugs and proposing features

- **Bug**: open an issue with the template — OS, GPU and VRAM, the engine
  (built-in llama.cpp and its build, or the service you connected), the model,
  and what you did.
- **Feature**: describe the problem before the shape. One boundary decides a
  lot up front: bonaparte is **not a model manager**. It downloads a short list
  of recommended models and reads the ones you already have.
- **Security**: never as a public issue — see [SECURITY.md](./SECURITY.md).
- Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Setup and commands

Node 24 (see `.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test          # unit tests, against the fake llama-server
pnpm build
pnpm --filter @aparte/bonaparte-app test:e2e   # end-to-end, on the built app
```

The whole list, with how to run one file and the environment variables the app
reads, is in [AGENTS.md](./AGENTS.md#commands). The end-to-end tests build
the app, then launch Electron on it with its window kept off your screen; they
never run on an app that is not built. CI runs the same commands on Ubuntu and
on Windows.

## The invariants

They are enforced by tests or lint, and a pull request that weakens one will
not be merged. They are listed, with their reasons, in
[AGENTS.md](./AGENTS.md#invariants--never-violate), next to the security rules.

## Commits

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:` …), one
  concern each, with a body that says **why** — the history is the project's
  memory.
- **English is the language of the repository**: code, comments, commit
  messages, documentation, plugin manifests. UI strings are localised (French
  and English) through the i18n files, never written in a component.
- Never skip a git hook or a signature. Fix what the hook reports.
- Stage explicit files. `docs/superpowers/` and everything under `.claude/`
  that is not tracked are private and ignored.

## Working with coding agents

The repository carries its own Claude Code configuration, in `.claude/`:

- `settings.json` — permissions, and two guard hooks. An agent never pushes:
  the maintainer does, after validating in the app. An agent never opens a
  visible console window on Windows.
- `agents/` — read-only sub-agents: `scout`, `aparte-docs`, `canvas-reader`,
  `v0-porter`, `reviewer`.
- `skills/` — the project's procedures: `phase-gate`, `screen`, `friction`,
  `smoke`, `run-app`.

`AGENTS.md` is the entry point for any agent, whatever the tool.
