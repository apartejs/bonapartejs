# AGENTS.md — bonaparte

Guidance for coding agents and contributors. `CLAUDE.md` imports this file
(`@AGENTS.md`); keep the two in sync by editing only this one.

bonaparte is a **local-first coding agent** for the desktop (Electron + React +
apartéJS, managed llama.cpp). Its differentiator: **per-conversation KV cache
persistence** through llama-server's slots. The full design notes are private,
in `docs/superpowers/` (git-ignored — **never** remove that line from
`.gitignore`; the repository is public).

## apartéJS friction journal — MANDATORY

bonaparte is also the proving ground of the apartéJS library (`@aparte/*`).
**Every friction met with the library is filed immediately**, the moment it
happens — never at the end of a session — as an issue on
https://github.com/apartejs/aparte/issues (in English: the repository is
public). Paul uses them to ship fixes and improvements to the library. The
private journal `docs/superpowers/aparte-frictions.md` keeps the history
of what was filed and the "Ça, c'était bien" section; it no longer receives
new frictions.

Counts as friction: a missing or awkward API, surprising behaviour, an
undocumented trap, documentation so absent you had to read the source, a
workaround you needed, a useless error message, an inconsistency between
packages. Notable good surprises go in the "Ça, c'était bien" section — so
nobody breaks what works.

The journal is private and written in French. One entry per friction, in this
shape:

```md
## AAAA-MM-JJ — titre court
- **Paquet** : @aparte/xxx@version
- **Contexte** : ce qu'on essayait de faire
- **Friction** : le problème précis
- **Contournement** : ce qu'on a fait dans bonaparte
- **Piste lib** : le correctif/l'amélioration suggérée côté apartéJS
- **Statut** : ouverte | résolue en x.y.z
```

When a library release fixes an entry, mark it resolved (never delete it).

## Invariants — never violate

- **Append-only prompt.** The frozen history of a `PromptLog` is NEVER
  re-rendered; everything goes through begin/complete. A change of tools or
  project is a delta appended to the log. Precisely: append-only *between two
  rebases* — a rebase (compaction) is an explicit event, never a side effect.
  This is what protects the KV cache.
- **`/completion` only** — never `/v1/chat/completions` (Qwen3's chat template
  is not byte-stable across turns, issue QwenLM/Qwen3#1826).
- **Strict restore.** A KV state is restored only when its manifest matches
  exactly (model fingerprint, `n_ctx`, cache types, llama.cpp build); on any
  doubt, re-prefill — announced.
- **`packages/core` never imports `electron`** (boundary enforced by lint).
- The renderer never talks to llama-server; there is no `AparteClient` in the
  renderer (it would run a second tool loop) — `<AparteChat>`'s imperative API
  is driven over IPC. Consequence: **we** call `registerDefaultRenderers()` at
  renderer startup (the library only does it in `AparteClient`'s constructor),
  otherwise every segment renders as "[Unknown segment type]" — covered by
  `aparte-bootstrap.spec.ts`.
- **A plugin never undoes its registrations by hand.** Everything goes through
  its context, which the host tears down as one. A failed activation leaves
  nothing behind, and nothing a plugin starts survives its teardown (dev
  server, shell, native view).
- **Nothing expensive without announcing it first** — the product rule. A
  model reload, a re-prefill, an eviction, a restart: the user sees the cost
  before paying it.

## How we work

- **Test first, always.** Red test, then the minimal implementation. The fake
  llama-server (`core/src/testing/fake-llama-server.ts`) is the fixture for
  everything that touches the backend — no GPU in CI, ever.
- **Localise from the first string.** One file per language (`types.ts` +
  `fr.ts` + `en.ts`; specs check key parity). **Localisation is for the UI.
  Everything sent to the model is English** — system prompt, tool
  descriptions, results, tool error messages, permission refusals: it is a
  protocol, and models are trained on English instructions and tool-calling.
  The reply language is an explicit prompt instruction (`replyLanguage`),
  driven by the locale.
- **English is the language of everything visible in the repository** —
  code, comments, commit messages, docs, plugin manifests. French is allowed
  only in the private notes (`docs/superpowers/`, `.claude/`).
- **shadcn/ui on Tailwind for our own controls; aparté for the chat.** The
  chat, the composer, the elicitation panel and the segment renderers come
  from `@aparte/*` — bonaparte exists to prove that library, they are never
  rewritten. Everything else we draw (sidebar, hub, panel, plugin views)
  uses the primitives in `@aparte/bonaparte-plugin-sdk/ui` (shadcn/ui,
  style new-york-v4, Radix, materialised as source — add one from the
  public registry `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`,
  imports rewritten to relative) and Tailwind utilities; no kit classes
  (`.aparte-btn`…) on our elements, no new hand-rolled CSS. Element-level
  defaults live in the `base` layer and skip `[data-slot]` controls.
  Semantic hook classes (`.conv-item`, `.setting-row`…) stay on elements,
  unstyled: the E2E and a host's rules read them. The app's stylesheets are
  four and small: `theme.css` (the palette, ours and the kit's), `index.css`
  (Tailwind's entry: sources, the dark variant, the theme mapping, the
  `base` layer with the element defaults and the shell's scrollbars),
  `layout.css` (the resizable flanks, which become overlay drawers when
  the window is narrow) and `terminal.css` (xterm's height
  chain). There is no `app.css` to add a rule to — a new look is a
  utility on the element, or a primitive.
- **The palette is React's, not the kit's.** react.dev's tokens (blue-50 /
  blue-30 accent, their gray scale), declared on the `--aparte-*` masters in
  `packages/app/src/renderer/src/theme.css` for light and dark; the kit
  derives inks and scales from them. The same palette is declared as shadcn's
  semantic variables (`--background`, `--primary`, `--muted`…) and Tailwind
  reads them (`bg-primary`, `text-muted-foreground`). Never hard-code a
  colour: read a token (`theme.spec.ts` E2E pins the palette in the DOM).
- **Professional UI finish from the first draft** — an unfinished screen is
  not shown. For layout changes, a validated mock-up comes before code.
- **What the fake server cannot prove is replayed for real** — grammars, slots,
  the KV prefix under agentic load. Record the result below when you do.
- **Local commits are free; NO push without Paul's validation in the app.**

## Commands

```sh
pnpm dev          # Electron app (electron-vite)
pnpm test         # whole unit suite (Nx, cached)
pnpm build        # every package and plugin
pnpm lint         # eslint + module boundaries
pnpm typecheck
pnpm --filter @aparte/bonaparte-app test:e2e   # Electron E2E (after pnpm build)
node packages/cli/dist/cli.js doctor            # machine diagnostic
# real-model smoke, outside CI (packages/core):
#   BONAPARTE_SMOKE_MODEL=<path.gguf> npx vitest run src/smoke
```

## Landmarks

- Design notes (private): v1 plan `docs/superpowers/specs/2026-08-18-bonaparte-v1-design.md`,
  consolidation `2026-08-19-bonaparte-consolidation.md` (amends the plan: single
  engine, layered prefix, one slot, retention budget), projects/conversations
  design `2026-08-20-projets-conversations-design.md`. The action plan to v1 is
  in `.claude/audit/03-plan-v1.md` (private).
- Paul's machine has the **unified `llama` CLI** (WindowsApps): server =
  `llama serve`, same flags as llama-server (`detectServeCommandPrefix()`).
- **Milestones.** J1 foundations + KV ✅ (validated for real by Paul on
  2026-08-18) · J2 agentic loop / tools / permissions / project ✅ in CI —
  **first real contact 2026-08-19**: prefill OK (1 295 tokens, 138 tok/s), the
  model triggers a tool call, the grammar refused the opening tag (fixed, see
  the grammar note below). **The rest of the agentic path — tool execution,
  result re-injected, second turn — has still not been seen end to end.** ·
  J3 plugin-first shell ✅ (reversible plugin host, tabbed tooling panel,
  schema-driven settings hub, status strip with context gauge, 5 built-in
  plugins, Playwright E2E) · Consolidation (2026-08-19): the screens are done,
  the engine is not — retention module, GGUF sizes, prefix seeds,
  compaction-as-rebase, `gpuAcceleration` setting, per-plugin activation,
  index and branching are still to do (see the plan) · **Phase 1, engine
  (2026-08-28)**: the prompt block order (stable → volatile), `EngineSupervisor`
  and `ConversationEngine` in core (the harness is IPC glue), `n_ctx` owned by
  the engine, the overflow guard with context shift off, a generation that
  survives navigation, approvals on apartéJS's elicitation panel, the apartéJS
  UI kit on every control — all done, 13 Electron E2E against the fake server;
  left in phase 1: the announced cost of a model switch, per-project
  allowlists · **2026-08-28 (evening)**: Tailwind + shadcn/ui shell on the
  React palette; prefix seeds (`KvStore.seedKey/saveSeed/restoreSeed`,
  restored or prepared at every fresh open, D-75); the KV manifest relaxed
  to what llama.cpp cannot check itself — the model file and the K/V types
  — n_ctx only has to hold the saved tokens and a build change no longer
  re-prefills (D-73); a per-conversation context cap (D-74); a security
  audit (private `.claude/audit/07`) with three findings fixed; a tray icon
  with close-to-tray (D-76) and an idle model unload (D-77) · J4 MCP · J5
  npx distribution.
- **Real-model smoke results.** Record here: date, model, llama.cpp build, and
  the outcome of each case.
  - **2026-09-26 (later) — 8/8 green**, same model and build. New case:
    **compaction is the rebase** — the model's summary, asked beside the
    conversation, kept the secret read from a file ("…contained the
    password ORANGE-42-VERMILLON…"); after the rebase the prompt restarts
    from a re-frozen system prompt and that summary alone, and the model
    answers the password from it, with no tool. Tool round-trip: 3 175
    tokens from the cache on turn 2 (prefill 19.9 ms); save/restore with
    tools 1 079 tokens; branch 602/602; seed 518 (prefill 16.7 ms).
  - **2026-09-26 — 7/7 green** (Qwen3-1.7B Q4_K_M, b10217-ddd4ec142, same
    settings). New case: **the managed server demands its per-launch key**
    — the real server answers `/props` without it with HTTP 401, and with
    it to the backend (`LLAMA_API_KEY` in the child's environment,
    `--no-webui`, `/props` checked against the launched model). Figures:
    tool round-trip served 1 755 tokens from the cache on turn 2 (prefill
    18.7 ms); save/restore with tool turns 893 tokens; branch 602 of 602;
    seed 518, first turn prefill 18.6 ms. A second full run timed out once
    on the cache case (the 1.7B reasoned past the per-case limit on turn
    1) and passed alone — the small model's dice, not the harness.
  - **2026-08-28 (evening) — 6/6 green.** Same model and build. New case:
    **prefix seeds** — a fresh conversation restores the shared prefix
    (518 tokens, the whole system block) and its first turn is served
    entirely from it (518 cached, prefill 16.5 ms); `n_predict: 0` leaves
    exactly the prefix in the slot. The branch case now opens B before
    restoring A's state: a fresh open restores the seed over the slot, so
    the state restored last is the one that serves — 599 of 599 again.
  - **2026-08-28 — 5/5 green.** Qwen3-1.7B Q4_K_M (unsloth), unified `llama`
    CLI build b10217-ddd4ec142, Windows, `-c 8192`, K/V f16, one slot,
    sampling temperature 0.2 / seed 42. Real tool call → execution → result
    → answer (the password read from the file, first time the whole agentic
    path was seen end to end) · lazy grammar not forcing a call · KV prefix
    kept after a tool round-trip (1 032 tokens served from the cache, prefill
    18.6 ms) · save/restore with tool turns (636 tokens restored, the secret
    recalled without rereading) · **a restored state serves as the prefix of
    a longer, different prompt: 545 of 545 saved tokens reused by a branch**
    — the property prefix seeds and branching rest on. Lessons: a 1.7B model
    at default temperature is a coin flip on protocol details (a ```json
    fence instead of `<tool_call>` once), and it invents a password unless
    the prompt names the tool; the smoke judges the harness, so its prompts
    name the tool and its sampling is fixed. The same run had shown the
    cache gauge reading zero on every real turn — `prompt_progress` never
    rides the final event; fixed in `http-client.ts`, fake server made
    faithful.
- **node-pty loads under Electron 43 WITHOUT a rebuild** (verified 2026-08-20:
  `pty.spawn(cmd.exe)` answers with its ConPTY sequences). It only needs to be
  allowed in `pnpm.onlyBuiltDependencies` — pnpm blocks build scripts by
  default, and without it the module installs with no binary. Paul's toolchain
  (VS Build Tools 2022+2026, Python 3.14) is enough. The terminal plugin is
  therefore a REAL terminal: xterm.js in the view, PTY in Node, raw bytes in
  between — never re-filter the ANSI, the emulator interprets it.
- **The plugin SDK PUSHES, with back-pressure** (`ctx.emit()` + `ctx.onDrain()`),
  the model taken from VS Code. `emit` returns `false` when the view is behind:
  the producer must stop — Node streams' `write` then `drain` convention.
  Thresholds in `FLOW_CONTROL` (host.ts), identical to theirs: pause at
  100 000 unacknowledged, resume under 5 000, acknowledge in packets of 5 000,
  **per instance**. **The view acknowledges in `term.write`'s callback** — when
  xterm has DISPLAYED, not when the IPC delivered — otherwise the producer
  restarts too early. Without this we lost output while pruning a buffer.
- **Still to do, and it is the lesson VS Code paid for**: their native Node
  halves run in a DEDICATED process. Ours (node-pty) live in the main process,
  so a segfault takes the application — and the loaded model — down. Planned:
  `utilityProcess`.
- **Third-party plugins outside the tree are not loadable yet.** Built-in
  views are collected by `import.meta.glob` (built with the app, loaded
  lazily); an external plugin will need Electron's custom protocol plus an
  import map sharing React. Extension point identified, deliberately not
  opened in v1 (double-React risk).
- **Tool-call grammar**: `grammar_lazy` + `grammar_triggers` + `preserved_tokens`
  on `/completion` — **undocumented** in llama.cpp's README, verified in
  `tools/server/server-schema.cpp`. Without laziness the model would be forced
  to call a tool every turn. **The trigger HANDS its text to the grammar**:
  `llama_grammar_accept_impl` (`src/llama-grammar.cpp`) calls
  `llama_grammar_accept_token(grammar, token, piece)` when a trigger token
  fires, and replays overlapping tokens for a pattern. The root must therefore
  consume `<tool_call>` itself, or the server throws "Unexpected empty grammar
  stack after accepting piece: <tool_call>" on the first call — met for real
  on 2026-08-19 (the tag is a single special token, id 248058, on Paul's
  model). The root also admits **several blocks**: with one, the grammar would
  be satisfied after the first call and parallel calls could not be emitted.
- The loop does NOT use `runStreamAgent` (`@aparte/engine`): that engine owns
  the message list, incompatible with the append-only prompt. Own loop in
  `core/src/agent/loop.ts` (friction recorded; the library added
  `onHistoryAppend` in 0.4.0 — decision: keep the own loop through v1, and
  pin every library rule the loop depends on with a contract test, as done for
  `isSegmentSettled` and `collapsed` after the 0.13 bump).
