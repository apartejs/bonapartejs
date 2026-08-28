import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintModelFile } from './fingerprint.js';

let dirs: string[] = [];

async function tmpModel(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-fp-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('fingerprintModelFile', () => {
  it('is stable for an unchanged file', async () => {
    const path = await tmpModel('qwen.gguf', 'content');
    expect(await fingerprintModelFile(path)).toBe(await fingerprintModelFile(path));
  });

  it('changes when the file is replaced (different size or mtime)', async () => {
    const path = await tmpModel('qwen.gguf', 'content');
    const before = await fingerprintModelFile(path);
    await writeFile(path, 'totally different content');
    await utimes(path, new Date(), new Date(Date.now() + 5000));
    expect(await fingerprintModelFile(path)).not.toBe(before);
  });

  it('differs between two distinct paths with identical content', async () => {
    const a = await tmpModel('a.gguf', 'same content');
    const b = await tmpModel('b.gguf', 'same content');
    expect(await fingerprintModelFile(a)).not.toBe(await fingerprintModelFile(b));
  });

  it('rejects with a clear error if the file is absent', async () => {
    await expect(
      fingerprintModelFile('C:\\nexiste\\pas.gguf'),
    ).rejects.toThrow(/pas\.gguf/);
  });
});
