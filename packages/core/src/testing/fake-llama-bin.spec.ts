/**
 * The fake llama-server binary: what the tests launch instead of llama.cpp.
 * It takes llama-server's arguments, demands its per-launch key, and serves
 * the fake server where it was told to. These tests launch it for real,
 * through `spawnHidden`, as the supervisor will.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLlamaBuildNumber } from '../backend/llamacpp/version.js';
import { spawnHidden, type SpawnedProcess } from '../process/spawn.js';

const BIN = fileURLToPath(new URL('./fake-llama-bin.mjs', import.meta.url));
const KEY = 'test-key-0123456789abcdefghijklmnop';

let children: SpawnedProcess[] = [];
afterEach(() => {
  for (const child of children) if (child.exitCode === null) child.kill();
  children = [];
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function launch(args: string[], env: Record<string, string> = {}) {
  const { LLAMA_API_KEY: _ignored, ...base } = process.env;
  const child = spawnHidden(process.execPath, [BIN, ...args], {
    env: { ...base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

async function healthy(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${port}/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing answered on port ${port}`);
}

describe('fake-llama-bin', () => {
  it('refuses to start without its key', async () => {
    const port = await freePort();
    const { exited, output } = launch(['-m', 'C:\\models\\a.gguf', '--port', String(port)]);
    expect(await exited).not.toBe(0);
    expect(output().stderr).toMatch(/LLAMA_API_KEY/);
  });

  it('serves the model it was given, on its port, to its key alone', async () => {
    const port = await freePort();
    launch(['-m', 'C:\\models\\a.gguf', '--port', String(port), '-np', '2', '-c', '8192'], {
      LLAMA_API_KEY: KEY,
    });
    await healthy(port);

    const props = await fetch(`http://127.0.0.1:${port}/props`, {
      headers: { authorization: `Bearer ${KEY}` },
    }).then((response) => response.json() as Promise<Record<string, any>>);
    expect(props['model_path']).toBe('C:\\models\\a.gguf');
    expect(props['total_slots']).toBe(2);
    // -c is shared between the slots.
    expect(props['default_generation_settings']['n_ctx']).toBe(4096);

    const keyless = await fetch(`http://127.0.0.1:${port}/props`);
    expect(keyless.status).toBe(401);
  });

  it('takes the arguments of the unified llama CLI too', async () => {
    const port = await freePort();
    launch(['serve', '-m', 'C:\\models\\b.gguf', '--port', String(port)], { LLAMA_API_KEY: KEY });
    await healthy(port);
    const props = await fetch(`http://127.0.0.1:${port}/props`, {
      headers: { authorization: `Bearer ${KEY}` },
    }).then((response) => response.json() as Promise<Record<string, any>>);
    expect(props['model_path']).toBe('C:\\models\\b.gguf');
  });

  it('answers --version with a build number, and leaves', async () => {
    const { exited, output } = launch(['--version']);
    expect(await exited).toBe(0);
    const { stdout, stderr } = output();
    expect(parseLlamaBuildNumber(stdout + stderr)).toBeGreaterThan(0);
  });

  it('goes away when it is killed, and the port with it', async () => {
    const port = await freePort();
    const { child, exited } = launch(['-m', 'm.gguf', '--port', String(port)], { LLAMA_API_KEY: KEY });
    await healthy(port);
    child.kill();
    await exited;
    const answered = await fetch(`http://127.0.0.1:${port}/health`).then(
      () => true,
      () => false,
    );
    expect(answered).toBe(false);
  });

  it('records each completion it is asked, and reads in the batches it was given', async () => {
    const port = await freePort();
    const dir = await mkdtemp(join(tmpdir(), 'fake-llama-bin-'));
    try {
      const requests = join(dir, 'requests.jsonl');
      launch(['-m', 'm.gguf', '--port', String(port)], {
        LLAMA_API_KEY: KEY,
        FAKE_LLAMA_REQUESTS: requests,
        FAKE_LLAMA_PREFILL_BATCH: '2',
      });
      await healthy(port);
      const prompt = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 characters: 8 tokens, 4 batches of 2
      const body = await fetch(`http://127.0.0.1:${port}/completion`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, n_predict: 3, stream: true, return_progress: true }),
      }).then((response) => response.text());
      const steps = body.split('\n').filter((line) => line.includes('"prompt_progress"'));
      expect(steps.length).toBeGreaterThanOrEqual(4);

      const lines = (await readFile(requests, 'utf8')).trim().split('\n');
      // How the prompt opens says the family it was rendered by: its first 24 characters.
      expect(lines.map((line) => JSON.parse(line))).toEqual([{ promptChars: 32, promptTokens: 8, nPredict: 3, opens: 'abcdefghijklmnopqrstuvwx' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
