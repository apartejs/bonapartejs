## What

<!-- One sentence, for the user: what changes from the outside. -->

## Why

## Cost to the user

<!-- Does this change cost a model reload, a re-prefill, an invalidated KV
     state, or a restart? Say so here, and make sure the app says so too. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` green
- [ ] Electron E2E green if the shell, the main process or a plugin changed
- [ ] Replayed against the real-model smoke test if grammars, slots or the
      prompt log changed (say which model and build)
- [ ] One concern per commit, conventional message, body says why
- [ ] UI strings added in **both** `fr` and `en`; nothing sent to the model is
      localised
- [ ] No invariant weakened (see AGENTS.md) — or the PR explains which and why
- [ ] `CHANGELOG.md` → *Unreleased* updated if the user can notice the change
