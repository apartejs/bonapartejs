/**
 * run_command: a program and its arguments — never a shell string, so that
 * nothing reads `&&`, `|` or `$( )` in them — run hidden (`spawnHidden`), in
 * a folder of the perimeter, without the secrets of bonaparte's environment,
 * for a limited time (two minutes by default, ten at most). What it wrote on
 * both outputs and how it ended are the result; a time limit or a stop is
 * said.
 */

import { withoutSecrets } from '../../process/env.js';
import { resolveCommand } from '../../process/command.js';
import { spawnHidden } from '../../process/spawn.js';
import { describeError, inPerimeter, refused, text, wholeNumber, workRoot, type BuiltinTool } from './common.js';
import type { ToolOutput } from '../types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
/** What is kept of a long output while it runs (the registry cuts it again for the context). */
const MAX_KEPT_CHARS = 1_000_000;

function argumentsOf(input: unknown): string[] | null {
  const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)['args'] : undefined;
  if (args === undefined) return [];
  return Array.isArray(args) && args.every((arg) => typeof arg === 'string') ? (args as string[]) : null;
}

export const runCommand: BuiltinTool = {
  def: {
    name: 'run_command',
    description:
      'Run a program with its arguments in the project (no shell: give the program and each argument apart). ' +
      'Returns what it printed and its exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'The program to run, e.g. "pnpm".' },
        args: { type: 'array', items: { type: 'string' }, description: 'Its arguments, one item each, e.g. ["test"].' },
        cwd: { type: 'string', description: 'The folder to run it in, relative to the project (its root by default).' },
        timeoutMs: { type: 'number', description: 'How long it may run, in milliseconds (120000 by default, 600000 at most).' },
      },
      required: ['program'],
    },
    effect: 'execute',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call, ctx) => {
    const program = text(call.input, 'program');
    if (!program) return refused('Missing argument: program.');
    const args = argumentsOf(call.input);
    if (args === null) return refused('args must be a list of strings, one per argument.');
    const requestedCwd = text(call.input, 'cwd');
    let cwd = workRoot(ctx);
    if (requestedCwd) {
      // The card shows the command, not its folder: an allowed call never widens where it runs.
      const resolved = inPerimeter({ ...ctx, granted: false }, requestedCwd);
      if ('error' in resolved) return refused(resolved.error);
      cwd = resolved.path;
    }
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, wholeNumber(call.input, 'timeoutMs') ?? DEFAULT_TIMEOUT_MS));
    const shown = [program, ...args].join(' ');

    const env = withoutSecrets(process.env);
    return new Promise<ToolOutput>((resolve) => {
      let child;
      try {
        // On Windows npm, npx, pnpm and yarn are .cmd shims: they run as node and their script, never through a
        // shell; a program the PATH does not hold is said so (audit 2026-11-21, D1).
        const resolved = resolveCommand(program, args, { env, cwd, notFound: 'refuse' });
        child = spawnHidden(resolved.command, resolved.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        resolve(refused(`Cannot run ${program}: ${describeError(error)}`));
        return;
      }
      ctx.onOutput?.({ kind: 'start', command: shown, cwd });
      let output = '';
      let ended: 'time' | 'stop' | null = null;
      const keep = (chunk: Buffer | string): void => {
        const text = chunk.toString();
        ctx.onOutput?.({ kind: 'data', text });
        if (output.length < MAX_KEPT_CHARS) output += text;
      };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      const stop = (why: 'time' | 'stop'): void => {
        if (ended) return;
        ended = why;
        child.kill();
      };
      const timer = setTimeout(() => stop('time'), timeoutMs);
      const onAbort = (): void => stop('stop');
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      if (ctx.signal.aborted) stop('stop');
      let settled = false;
      const finish = (result: ToolOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      child.on('error', (error) =>
        finish(
          refused(
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? `Cannot run ${program}: it was not found${/[\\/]/.test(program) ? '' : ' on the PATH'}.`
              : `Cannot run ${program}: ${describeError(error)}`,
          ),
        ),
      );
      child.on('close', (code) => {
        ctx.onOutput?.({ kind: 'exit', code });
        const printed = output.trimEnd();
        const end =
          ended === 'time'
            ? `[The command was stopped after ${timeoutMs / 1000} s: its time limit.]`
            : ended === 'stop'
              ? '[The command was stopped: the turn was stopped.]'
              : `[exit code ${code ?? 'unknown'}]`;
        finish({
          content: `$ ${shown}\n${printed === '' ? '(no output)' : printed}\n${end}`,
          structuredContent: { exitCode: code, ...(ended ? { stopped: ended } : {}) },
        });
      });
    });
  },
};
