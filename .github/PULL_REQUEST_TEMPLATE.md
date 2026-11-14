## What

<!-- One sentence, for the user: what changes from the outside. -->

## Why

## Cost to the user

<!-- Does this change cost a model load, a re-read of a conversation, an
     invalidated KV state, a download or a restart? Say so here, and make sure
     the app says so too. -->

## Checklist

- [ ] The gate is green: every command listed in `AGENTS.md` under "Commands"
- [ ] A test failed before the change and passes after it
- [ ] Replayed against the real-model smoke test if the engine, the prompt,
      the tool grammar or the KV memory changed (say which model and build)
- [ ] One concern per commit, conventional message, body says why
- [ ] UI strings added in **both** `fr` and `en`; nothing sent to the model is
      localised
- [ ] No colour written outside the tokens file; no second UI library
- [ ] No invariant and no security rule weakened (see `AGENTS.md`) — or the
      pull request explains which and why
- [ ] `CHANGELOG.md` → *Unreleased* updated if the user can notice the change
