/**
 * The safety net every harness has: what a turn changed on
 * disk can be taken back. Before a tool writes a file, its original — or
 * its absence — is kept, per turn, in the app's data (never in the user's
 * repository). Undo restores it; a file changed again since is left alone
 * and named, never overwritten.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckpointStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function rig(): Promise<{ store: CheckpointStore; repo: string }> {
  return { store: new CheckpointStore(await temp('bp-ckpt-data-')), repo: await temp('bp-ckpt-repo-') };
}

describe('CheckpointStore', () => {
  it('records what a turn changed, and undo puts every file back', async () => {
    const { store, repo } = await rig();
    const edited = join(repo, 'a.ts');
    const created = join(repo, 'new.ts');
    await writeFile(edited, 'original', 'utf8');

    await store.before('conv', 'turn-1', edited, 'a.ts');
    await writeFile(edited, 'changed by the model', 'utf8');
    await store.after('conv', 'turn-1', edited);
    await store.before('conv', 'turn-1', created, 'new.ts');
    await writeFile(created, 'a new file', 'utf8');
    await store.after('conv', 'turn-1', created);

    expect(await store.changes('conv', 'turn-1')).toEqual({ files: ['a.ts', 'new.ts'], undone: false });

    const result = await store.undo('conv', 'turn-1');

    expect(result).toEqual({ restored: ['a.ts', 'new.ts'], conflicts: [] });
    expect(await readFile(edited, 'utf8')).toBe('original');
    expect(existsSync(created)).toBe(false);
    expect((await store.changes('conv', 'turn-1'))?.undone).toBe(true);
  });

  it('the first original wins: a file written twice in a turn goes back to before the turn', async () => {
    const { store, repo } = await rig();
    const file = join(repo, 'a.ts');
    await writeFile(file, 'v0', 'utf8');
    await store.before('conv', 't', file, 'a.ts');
    await writeFile(file, 'v1', 'utf8');
    await store.after('conv', 't', file);
    await store.before('conv', 't', file, 'a.ts');
    await writeFile(file, 'v2', 'utf8');
    await store.after('conv', 't', file);

    expect((await store.changes('conv', 't'))?.files).toEqual(['a.ts']);
    await store.undo('conv', 't');
    expect(await readFile(file, 'utf8')).toBe('v0');
  });

  it('a file changed again since the turn is left alone and named', async () => {
    const { store, repo } = await rig();
    const file = join(repo, 'a.ts');
    await writeFile(file, 'original', 'utf8');
    await store.before('conv', 't', file, 'a.ts');
    await writeFile(file, 'by the model', 'utf8');
    await store.after('conv', 't', file);
    await writeFile(file, 'by the user, afterwards', 'utf8');

    const result = await store.undo('conv', 't');

    expect(result).toEqual({ restored: [], conflicts: ['a.ts'] });
    expect(await readFile(file, 'utf8')).toBe('by the user, afterwards');
  });

  it('a turn that changed nothing has no checkpoint; undoing twice is harmless', async () => {
    const { store, repo } = await rig();
    expect(await store.changes('conv', 'none')).toBeUndefined();
    const file = join(repo, 'a.ts');
    await writeFile(file, 'x', 'utf8');
    await store.before('conv', 't', file, 'a.ts');
    await writeFile(file, 'y', 'utf8');
    await store.after('conv', 't', file);
    await store.undo('conv', 't');
    expect(await store.undo('conv', 't')).toEqual({ restored: [], conflicts: [] });
  });

  it('forget drops a conversation\'s checkpoints (a deleted conversation)', async () => {
    const { store, repo } = await rig();
    const file = join(repo, 'a.ts');
    await writeFile(file, 'x', 'utf8');
    await store.before('conv', 't', file, 'a.ts');
    await store.forget('conv');
    expect(await store.changes('conv', 't')).toBeUndefined();
  });
});
