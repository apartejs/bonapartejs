---
name: friction
description: Use the moment the apartéJS library (@aparte/*) resists - a missing or awkward API, a surprising behaviour, an undocumented trap, documentation so thin you had to read the source, a workaround you needed, a useless error message, an inconsistency between packages. Files the friction as a GitHub issue on apartejs/aparte, then goes back to work.
---

# Filing an aparté friction

bonaparte is the proving ground of apartéJS. Every friction is filed when it
happens, never at the end of a session: the library's maintainer plans its
fixes from these issues.

## 1. Check that it is still true

The library ships several releases a week.

```sh
npm view @aparte/core version
gh release list --repo apartejs/aparte --limit 5
```

Read the notes of any release newer than the version bonaparte installs
(`gh release view vX.Y.Z --repo apartejs/aparte`). If the friction is already
fixed there, upgrade instead of filing.

## 2. Look for a duplicate

```sh
gh issue list --repo apartejs/aparte --state all --search "<two or three words>"
```

An open issue that covers it gets a comment with the new case, not a second
issue. An issue can stay open after its fix has shipped: check the release
notes before you conclude anything from its state.

## 3. Write the issue, in English

The repository is public. Use its format:

- **Use case**: what bonaparte was trying to do, in terms a reader of the
  library understands.
- **What is possible today**: what the library offers, with the file or the
  documentation page; the workaround used in bonaparte.
- **Proposal**: the smallest change on the library's side.
- **Environment**: the package and its version, the runtime.

Nothing private goes in: no path of this machine, no name, no content from
`docs/superpowers/`, no detail of a conversation.

## 4. File it

Write the body to a file, then:

```sh
gh issue create --repo apartejs/aparte --title "<package or area>: <what is missing>" --label enhancement --body-file <file>
```

Use the label `bug` for wrong behaviour, `documentation` for a gap in the
docs, `enhancement` for a missing API.

## 5. Leave a trace, then continue

- Add the issue to `docs/superpowers/plans/SUIVI.md`, under "Frictions aparté
  déposées": its number, its subject, the workaround in place.
- Put the issue number in a comment where the workaround lives, so that it is
  removed when the fix ships.

A notable good surprise is not an issue: pin it with a contract test in
bonaparte, so that nobody breaks what works.
