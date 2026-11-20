/**
 * run_command runs a program with its arguments — never a shell string — in a
 * folder of the perimeter, without the secrets of bonaparte's environment,
 * for a limited time. What it printed and how it ended are the result.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

describe.runIf(process.platform === 'win32')('run_command on Windows: the npm family runs, without a shell (audit 2026-11-21, D1)', () => {
  it('npm runs a script of the project, and npx answers', async () => {
    const ctx = await context();
    const root = ctx.roots[0]!;
    // npm runs a script through cmd itself: the test's script is a file, never `node -e` with quotes.
    await writeFile(join(root, 'hello.js'), 'console.log("hello from " + process.argv[2])\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bp-run-npm', private: true, scripts: { hello: 'node hello.js npm' } }));
    const result = await run({ program: 'npm', args: ['run', 'hello'] }, ctx);
    expect(result.failed).toBeUndefined();
    expect(result.content).toContain('hello from npm');
    expect(result.content).toMatch(/exit code 0/);
    const npx = await run({ program: 'npx', args: ['--version'] }, ctx);
    expect(npx.content).toMatch(/\d+\.\d+\.\d+/);
    expect(npx.content).toMatch(/exit code 0/);
  }, 60_000);

  it('a program the PATH does not hold is said so in words the model can act on — not « spawn … ENOENT »', async () => {
    const result = await run({ program: 'bonaparte-no-such-tool', args: [] });
    expect(result).toMatchObject({ failed: true });
    expect(result.content).toMatch(/bonaparte-no-such-tool was not found on the PATH/);
    expect(result.content).not.toMatch(/ENOENT/);
  });

  it('a batch file of the project is refused, saying why', async () => {
    const ctx = await context();
    await writeFile(join(ctx.roots[0]!, 'build.bat'), '@echo off\r\necho built\r\n');
    const result = await run({ program: 'build.bat', args: [] }, ctx);
    expect(result).toMatchObject({ failed: true });
    expect(result.content).toMatch(/shell/);
  });
});

describe('run_command', () => {
  it('runs the program with its arguments, as they are: no shell reads them', async () => {
    const result = await run(node('console.log(process.argv[1])', 'a && b | c; $(d)'));
    expect(result.content).toContain('a && b | c; $(d)');
    expect(result.content).toMatch(/exit code 0/);
    expect(result.failed).toBeUndefined();
  });

  it('tells what it runs as it runs: the command, what it prints, how it ended (the terminal\'s agent tab)', async () => {
    const told: unknown[] = [];
    const ctx = { ...(await context()), onOutput: (event: unknown) => told.push(event) };
    await run(node('process.stdout.write("one"); process.stderr.write("two"); process.exit(2)'), ctx);
    expect(told[0]).toMatchObject({ kind: 'start' });
    expect((told[0] as { command: string }).command.startsWith(`${process.execPath} -e`)).toBe(true);
    const printed = told.filter((event) => (event as { kind: string }).kind === 'data').map((event) => (event as { text: string }).text);
    expect(printed.join('')).toContain('one');
    expect(printed.join('')).toContain('two');
    expect(told.at(-1)).toEqual({ kind: 'exit', code: 2 });
  });

  it('says how the program ended, and what it wrote on both outputs', async () => {
    const result = await run(node('console.error("oops"); process.exit(3)'));
    expect(result.content).toContain('oops');
    expect(result.content).toMatch(/exit code 3/);
  });

  it("an allowed call never widens the folder it runs in: the card shows the command, not its folder", async () => {
    const ctx = await context();
    const result = await run({ ...node('0'), cwd: '..' }, { ...ctx, granted: true });
    expect(result).toMatchObject({ failed: true });
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
