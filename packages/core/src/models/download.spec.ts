/**
 * A download bonaparte runs: it resumes where a cut one stopped (a range
 * request), reports its progress, and keeps the file only if its SHA-256 is
 * the one announced — what is not verified is never run.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DigestMismatchError, downloadFile } from './download.js';

const CONTENT = randomBytes(256 * 1024);
const SHA256 = createHash('sha256').update(CONTENT).digest('hex');

let servers: Server[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

/** Serves CONTENT, honouring a range unless told not to; records the ranges it was asked. */
async function serve(options: { ranges?: boolean } = {}) {
  const asked: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    asked.push(req.headers.range);
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (match && options.ranges !== false) {
      const from = Number(match[1]);
      res.writeHead(206, { 'content-length': CONTENT.length - from });
      res.end(CONTENT.subarray(from));
      return;
    }
    res.writeHead(200, { 'content-length': CONTENT.length });
    res.end(CONTENT);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/llama.zip`, asked };
}

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-download-'));
  dirs.push(dir);
  return dir;
}

describe('downloadFile', () => {
  it('downloads, verifies the digest, and reports its progress up to the whole size', async () => {
    const { url } = await serve();
    const dest = join(await folder(), 'llama.zip');
    const progress: { done: number; total: number | null }[] = [];
    await downloadFile({ url, dest, sha256: SHA256, onProgress: (step) => progress.push(step) });
    expect(await readFile(dest)).toEqual(CONTENT);
    expect(progress.at(-1)).toEqual({ done: CONTENT.length, total: CONTENT.length });
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });

  it('resumes where a cut download stopped, asking only for the rest', async () => {
    const { url, asked } = await serve();
    const dest = join(await folder(), 'llama.zip');
    await writeFile(`${dest}.part`, CONTENT.subarray(0, 100_000));
    await downloadFile({ url, dest, sha256: SHA256 });
    expect(asked).toEqual(['bytes=100000-']);
    expect(await readFile(dest)).toEqual(CONTENT);
  });

  it('starts over when the server ignores the range', async () => {
    const { url } = await serve({ ranges: false });
    const dest = join(await folder(), 'llama.zip');
    await writeFile(`${dest}.part`, Buffer.from('half of something else'));
    await downloadFile({ url, dest, sha256: SHA256 });
    expect(await readFile(dest)).toEqual(CONTENT);
  });

  it('keeps nothing whose digest is not the one announced', async () => {
    const { url } = await serve();
    const dest = join(await folder(), 'llama.zip');
    await expect(downloadFile({ url, dest, sha256: '0'.repeat(64) })).rejects.toBeInstanceOf(DigestMismatchError);
    await expect(stat(dest)).rejects.toThrow();
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });

  it('a download stopped on purpose keeps what it has, to resume it', async () => {
    const { url } = await serve();
    const dest = join(await folder(), 'llama.zip');
    const controller = new AbortController();
    const download = downloadFile({
      url,
      dest,
      sha256: SHA256,
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done > 0) controller.abort();
      },
    });
    await expect(download).rejects.toThrow();
    await expect(stat(dest)).rejects.toThrow();
    expect((await stat(`${dest}.part`)).size).toBeGreaterThan(0);
  });
});
