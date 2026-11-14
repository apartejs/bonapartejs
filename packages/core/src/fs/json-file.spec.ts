/**
 * The small JSON files bonaparte keeps (a conversation's meta, the app's
 * config, the MCP servers) are read by one part while another rewrites
 * them — a turn, the sidebar, a click in the hub. A reader must never take
 * a half-written file for an empty one (the config fell back to `{}` and
 * was saved back: everything lost), and two read-modify-writes must never
 * lose each other's change.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KeyedQueue, readJsonFile, writeJsonFile } from './json-file.js';

const dir = () => mkdtemp(join(tmpdir(), 'bp-json-'));

describe('writeJsonFile / readJsonFile', () => {
  it('round-trips, and a missing file is ENOENT — not an empty object', async () => {
    const file = join(await dir(), 'a.json');
    await expect(readJsonFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeJsonFile(file, { a: 1, nested: { b: [1, 2] } });
    expect(await readJsonFile(file)).toEqual({ a: 1, nested: { b: [1, 2] } });
    expect(await readFile(file, 'utf8')).toContain('\n  "a": 1');
  });

  it('readers during a storm of writes only ever see whole files', async () => {
    const file = join(await dir(), 'config.json');
    await writeJsonFile(file, { n: 0, padding: 'x'.repeat(20_000) });
    let writing = true;
    const seen: number[] = [];
    const reader = (async () => {
      while (writing) seen.push(((await readJsonFile(file)) as { n: number }).n);
    })();
    for (let n = 1; n <= 60; n++) await writeJsonFile(file, { n, padding: 'x'.repeat(20_000) });
    writing = false;
    await reader;
    expect(seen.length).toBeGreaterThan(0);
    expect(((await readJsonFile(file)) as { n: number }).n).toBe(60);
    // Sixty renames under a reader: on Windows, with the suite in parallel and an
    // antivirus scanning, this takes longer than the default five seconds — the
    // test is about whole files, not speed.
  }, 30_000);

  it('reads what Windows editors write: a UTF-8 BOM, or UTF-16 from PowerShell', async () => {
    const folder = await dir();
    const bom = join(folder, 'bom.json');
    await writeFile(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}', 'utf8')]));
    expect(await readJsonFile(bom)).toEqual({ a: 1 });
    const utf16 = join(folder, 'utf16.json');
    await writeFile(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"b":2}', 'utf16le')]));
    expect(await readJsonFile(utf16)).toEqual({ b: 2 });
  });

  it('a file that stays unreadable is an error, after a few tries', async () => {
    const file = join(await dir(), 'bad.json');
    await writeFile(file, '{ nope', 'utf8');
    await expect(readJsonFile(file)).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe('KeyedQueue', () => {
  it('runs one task at a time per key, in order, and a failure does not block the next', async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const slow = (label: string, ms: number) => async () => {
      log.push(`start ${label}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${label}`);
      return label;
    };
    const results = await Promise.allSettled([
      queue.run('a', slow('a1', 20)),
      queue.run('a', async () => {
        throw new Error('boom');
      }),
      queue.run('a', slow('a2', 1)),
      queue.run('b', slow('b1', 1)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    // b does not wait for a; within a, strictly one after the other.
    expect(log.indexOf('end a1')).toBeLessThan(log.indexOf('start a2'));
    expect(log.indexOf('start b1')).toBeLessThan(log.indexOf('end a1'));
  });
});
