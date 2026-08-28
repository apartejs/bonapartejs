# Security Policy

## Supported versions

bonaparte is pre-1.0. Only the **latest released version** of the
`@aparte/bonaparte*` packages receives security fixes — they ship in lockstep,
so upgrading one number upgrades the set.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:
**https://github.com/apartejs/bonapartejs/security/advisories/new**
(Repository → Security → Report a vulnerability.)

You should get a first response within a few days. Please include the
platform, the llama.cpp build, and a minimal reproduction — a conversation or
tool call that triggers the behaviour.

## Scope notes for researchers

bonaparte runs an agent with tools on the user's machine, so the interesting
surface is the boundary between what the model may do and what it does.

- **Tool perimeter.** File tools resolve paths against the open project's roots
  (`resolveInPerimeter`) and must refuse anything that lands outside them. A
  path, symlink or encoding trick that escapes the perimeter is in scope.
- **Permission modes.** `lecture` must never write or execute; `repetition`
  must ask before every effectful call; `plume` must ask before commands. A tool
  call that runs without the approval its mode requires is in scope.
- **Shell tool.** `run_shell` is bounded (timeout, captured output). Escapes
  from those bounds, or command injection through tool arguments, are in scope.
- **Plugins.** Only built-in plugins load in this version; the host tears down a
  plugin's registrations as one. A plugin surviving its deactivation, or reaching
  the renderer beyond the typed bridge, is in scope.
- **Browser plugin.** Pages open in a separate `WebContentsView`. Any path from a
  loaded page to the main process, the preload bridge or the agent's tools is in
  scope. External links open only through an allowlist.
- **Local model server.** The managed `llama-server` binds to `127.0.0.1`. The
  optional remote mode points bonaparte at a server you run yourself — its
  exposure is your responsibility, not a bonaparte issue.
- **Data on disk.** Conversation logs and saved KV states live under the
  application data directory (`%APPDATA%\bonaparte`, `~/.bonaparte`) in clear.
  They contain your prompts and tool outputs; they are not encrypted, by design.

Out of scope: prompt injection that merely *convinces* the model to request an
action the permission mode then asks you about; behaviour of `impro` mode, which
is documented as "everything passes"; vulnerabilities in llama.cpp itself
(report those upstream at ggml-org/llama.cpp).

## Disclosure

Coordinated disclosure preferred. Fixes ship as a patch release across all
packages with the advisory credited in the changelog (unless you prefer
anonymity).
