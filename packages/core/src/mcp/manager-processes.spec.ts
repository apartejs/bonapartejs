/**
 * What an MCP server's processes become (adversarial reviews, 2026-09-26):
 * a server stopped while it is still connecting goes down with its whole
 * tree — `npx` is a wrapper on Windows; a server that died is never
 * "killed" again by its old pid, which Windows may have given to another
 * program; and a server whose list of tools never ends does not hold the
 * others.
 */

import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from '../testing/fake-mcp-http.js';
import { ToolRegistry } from '../tools/registry.js';
import { McpClientManager } from './manager.js';

const taskkills: string[][] = [];
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawnSync: (command: string, args: string[], options: object) => {
      if (command === 'taskkill') taskkills.push(args);
      return original.spawnSync(command, args, options);
    },
  };
});

const FAKE = fileURLToPath(new URL('../testing/fake-mcp-server.mjs', import.meta.url));
const managers: McpClientManager[] = [];
const https: FakeMcpHttpServer[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
  await Promise.all(https.splice(0).map((server) => server.close()));
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(predicate: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('McpClientManager — processes', () => {
  it.runIf(process.platform === 'win32')(
    'a server stopped while still connecting goes down with its tree',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bp-mcp-proc-'));
      const wrapper = join(dir, 'server.cmd');
      await writeFile(wrapper, `@"${process.execPath}" "${FAKE}" %*\r\n`, 'utf8');
      const pidFile = join(dir, 'pid');
      const manager = new McpClientManager({ registry: new ToolRegistry() });
      managers.push(manager);
      const starting = manager.apply([
        {
          id: 'slow',
          transport: 'stdio',
          command: wrapper,
          env: { FAKE_MCP_SLOW_START: '5000', FAKE_MCP_IGNORE_EOF: '1', FAKE_MCP_PID_FILE: pidFile },
          disabled: false,
        },
      ]);
      await until(async () => (await readFile(pidFile, 'utf8').catch(() => '')) !== '');
      const pid = Number(await readFile(pidFile, 'utf8'));

      await manager.apply([]);
      await starting;

      await until(() => !alive(pid), 3_000);
    },
  );

  it('a server that died is not killed again by its old pid', async () => {
    const registry = new ToolRegistry();
    const manager = new McpClientManager({ registry });
    managers.push(manager);
    await manager.apply([{ id: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE], disabled: false }]);
    const ctx = { roots: [], signal: new AbortController().signal };
    await registry.get('mcp__fake__crash')?.handler({}, ctx);
    await until(() => manager.status()[0]?.state === 'failed');
    taskkills.length = 0;

    await manager.apply([]);

    expect(taskkills).toEqual([]);
  });

  it('a server whose list of tools never ends does not hold apply()', async () => {
    const server = await startFakeMcpHttpServer({ endlessPages: true });
    https.push(server);
    const manager = new McpClientManager({ registry: new ToolRegistry(), connectTimeoutMs: 2_000 });
    managers.push(manager);

    const outcome = await Promise.race([
      manager.apply([{ id: 'endless', transport: 'http', url: server.url, disabled: false }]).then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 4_000)),
    ]);

    expect(outcome).toBe('settled');
    expect(manager.status()[0]?.state).toBe('failed');
  });
});
