/**
 * run_command runs a program with its arguments — never a shell string — in a
 * folder of the perimeter, without the secrets of bonaparte's environment,
 * for a limited time. What it printed and how it ended are the result.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../types.js';
import { runCommand } from './run-command.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
  delete process.env['BP_TEST_API_KEY'];
});

async function context(signal = new AbortController().signal): Promise<ToolContext> {
  const root = await mkdtemp(join(tmpdir(), 'bp-run-'));
  dirs.push(root);
  return { conversationId: 'c1', roots: [root], nCtx: 8_192, signal };
}

const run = async (input: unknown, ctx?: ToolContext) => runCommand.handler({ id: 't1', name: 'run_command', input }, ctx ?? (await context()));
const node = (script: string, ...rest: string[]) => ({ program: process.execPath, args: ['-e', script, ...rest] });

describe('run_command', () => {
  it('runs the program with its arguments, as they are: no shell reads them', async () => {
    const result = await run(node('console.log(process.argv[1])', 'a && b | c; $(d)'));
    expect(result.content).toContain('a && b | c; $(d)');
    expect(result.content).toMatch(/exit code 0/);
    expect(result.failed).toBeUndefined();
  });

  it('says how the program ended, and what it wrote on both outputs', async () => {
    const result = await run(node('console.error("oops"); process.exit(3)'));
    expect(result.content).toContain('oops');
    expect(result.content).toMatch(/exit code 3/);
  });

  it('runs in the project, and refuses a folder outside it', async () => {
    const ctx = await context();
    expect((await run(node('console.log(process.cwd())'), ctx)).content).toContain(ctx.roots[0]!);
    expect(await run({ ...node('0'), cwd: '../elsewhere' }, ctx)).toMatchObject({ failed: true });
  });

  it('stops a program that goes over its time, and says so', async () => {
    const started = Date.now();
    const result = await run({ ...node('setTimeout(() => {}, 20000)'), timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.content).toMatch(/stopped after 0\.3 s/);
  });

  it('stops when the turn is stopped', async () => {
    const controller = new AbortController();
    const pending = run(node('setTimeout(() => {}, 20000)'), await context(controller.signal));
    setTimeout(() => controller.abort(), 200);
    expect((await pending).content).toMatch(/stopped/);
  });

  it("never passes on bonaparte's secrets", async () => {
    process.env['BP_TEST_API_KEY'] = 'sk-do-not-leak';
    const result = await run(node('console.log(process.env.BP_TEST_API_KEY ?? "none")'));
    expect(result.content).toContain('none');
    expect(result.content).not.toContain('sk-do-not-leak');
  });

  it('says what is missing, and a program that cannot start', async () => {
    expect(await run({})).toMatchObject({ failed: true, content: 'Missing argument: program.' });
    expect(await run({ program: 'node', args: [1, 2] })).toMatchObject({ failed: true });
    expect(await run({ program: 'surely-no-such-program-here', args: [] })).toMatchObject({ failed: true });
  });
});
