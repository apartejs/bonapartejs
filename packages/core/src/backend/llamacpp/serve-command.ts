/**
 * llama.cpp exists in two forms: the historical `llama-server` binary
 * (flags directly) and the unified `llama` CLI (b10xxx+, `serve`
 * subcommand ahead of the same flags). Infers the argument prefix from the
 * binary's name.
 */

export function detectServeCommandPrefix(binPath: string): string[] {
  const base = binPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const name = base.endsWith('.exe') ? base.slice(0, -4) : base;
  return name === 'llama' ? ['serve'] : [];
}
