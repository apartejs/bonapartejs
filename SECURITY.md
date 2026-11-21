# Security Policy

## Supported versions

Only the **latest released version** of the `@aparte/bonaparte*` packages, and
of the installer, receives security fixes — they ship in lockstep, so
upgrading one number upgrades the set.

## Reporting a vulnerability

Please **do not describe a security problem where others can read it** — a
public issue, a discussion, a pull request.

While the repository is private, GitHub offers no private vulnerability
reporting on it. Open an issue on
**https://github.com/apartejs/bonapartejs/issues** — only people with access
to the repository see it — with the label `security` and a title that says
no more than « Security report ». Without access, ask the maintainers on
**https://github.com/apartejs/aparte/security/advisories/new** (the apartéJS
library's repository, which is public and takes private reports), naming
bonaparte in the title.

Once the repository is public, use its own private reporting instead:
**https://github.com/apartejs/bonapartejs/security/advisories/new**
(Repository → Security → Report a vulnerability).

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
  call that runs without the approval its mode requires is in scope — and so is
  a rule kept by « Toujours autoriser » that lets through more than the exact
  command, folder, site or tool its card named.
- **Files that run later.** A write to `package.json`, a git hook, `.env`, a
  `*.config.*` file and the like is asked in every mode; one that passes
  without asking is in scope.
- **Commands.** `run_command` runs a program with an argument array, never
  through a shell, and a bare program name is found on the PATH only. Command
  injection through tool arguments, or a program run from somewhere the card
  did not show, is in scope.
- **The network.** `web_fetch` and the agent's browser tab refuse local and
  private addresses unless a setting allows them. Reaching one anyway — by a
  redirect, DNS rebinding or an encoding of the address — is in scope.
- **Plugins.** A plugin is read before anything of it runs; its Node half runs
  in a process of its own, and its view in a sandboxed frame without the
  bridge. A plugin reaching more than the effects it declared, surviving its
  deactivation, or reaching the window beyond its frame, is in scope.
- **Browser.** Pages open in a separate `WebContentsView`, in a session that
  holds none of the person's logins for the agent's tab. Any path from a
  loaded page to the main process, the preload bridge or the agent's tools is
  in scope.
- **Local model server.** The managed `llama-server` binds to `127.0.0.1` and
  demands a key made for each launch. A service you add (Ollama, LM Studio, an
  OpenAI-compatible API) is one you run or chose — its exposure is your
  responsibility, not a bonaparte issue.
- **Data on disk.** Conversation logs and saved KV states live under the
  application data directory (`%APPDATA%\bonaparte` on Windows, `~/.bonaparte`
  elsewhere) in clear. They contain your prompts and tool outputs; they are not
  encrypted, by design. API keys live in the system's vault, never there.

Out of scope: prompt injection that merely *convinces* the model to request an
action the permission mode then asks you about; what `impro` mode lets through
without asking, as documented (it still asks what is always asked); and
vulnerabilities in llama.cpp itself (report those upstream at
ggml-org/llama.cpp).

## Disclosure

Coordinated disclosure preferred. Fixes ship as a patch release across all
packages with the advisory credited in the changelog (unless you prefer
anonymity).
