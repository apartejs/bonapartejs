# ('.') bonaparte

**A local-first coding agent, for developers who run their models on their own
machine.** A desktop app built on [apartéJS](https://apartejs.dev), driving a
managed llama.cpp server and remembering the inference state (KV cache) of
every conversation.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Status: starting over (November 2026).** The first implementation is
> archived on the `archive/v0` branch. The new one starts from a design made
> first; there is no code on `main` yet.

## Why

Every coding agent out there is cloud-first. That is fine against an API that
caches prompts server-side; it is a tax on a local model. Resuming a long
conversation means re-processing its entire context, every time you come back.

bonaparte saves and restores the **KV cache per conversation** through
llama-server's slots: reopening a long conversation tomorrow costs seconds of
disk I/O, not minutes of GPU time.

One rule drives every screen: **nothing expensive happens without being
announced first.**

## Contributing

bonaparte is the proving ground of apartéJS: friction with the library is fed
back upstream rather than worked around in silence. Security issues:
[SECURITY.md](./SECURITY.md), never as a public issue. Conduct:
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © 2026 Paul Richez
