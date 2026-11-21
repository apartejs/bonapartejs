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

  /** A tool's write, as the registry wraps it. */
  async function write(store: CheckpointStore, turn: string, path: string, display: string, content: string): Promise<void> {
    await store.before('conv', turn, path, display);
    await writeFile(path, content, 'utf8');
    await store.after('conv', turn, path);
  }

  it('lists what a conversation changed, across its turns: each file once, created or not, its original from before the first', async () => {
    const { store, repo } = await rig();
    const edited = join(repo, 'a.ts');
    const created = join(repo, 'new.ts');
    await writeFile(edited, 'v0', 'utf8');
    await write(store, 'turn-1', edited, 'a.ts', 'v1');
    await write(store, 'turn-2', edited, 'a.ts', 'v2');
    await write(store, 'turn-2', created, 'new.ts', 'fresh');
    expect(await store.files('conv')).toMatchObject([
      { path: edited, display: 'a.ts', created: false },
      { path: created, display: 'new.ts', created: true },
    ]);
    // When the last turn that changed it wrote (review of C4).
    expect((await store.files('conv')).every((file) => typeof file.lastAt === 'string')).toBe(true);
    expect((await store.original('conv', edited))?.toString('utf8')).toBe('v0');
    expect(await store.original('conv', created)).toBeNull();
    expect(await store.original('conv', join(repo, 'untouched.ts'))).toBeUndefined();
    // A turn undone: what it alone wrote is no longer listed.
    await store.undo('conv', 'turn-2');
    expect((await store.files('conv')).map((file) => file.display)).toEqual(['a.ts']);
  });

  it('« Revenir » on one file: back to before the conversation, the others untouched; a file changed since is named, not touched', async () => {
    const { store, repo } = await rig();
    const a = join(repo, 'a.ts');
    const b = join(repo, 'b.ts');
    const created = join(repo, 'new.ts');
    await writeFile(a, 'a0', 'utf8');
    await writeFile(b, 'b0', 'utf8');
    await write(store, 'turn-1', a, 'a.ts', 'a1');
    await write(store, 'turn-1', b, 'b.ts', 'b1');
    await write(store, 'turn-2', a, 'a.ts', 'a2');
    await write(store, 'turn-2', created, 'new.ts', 'fresh');

    expect(await store.revertFile('conv', a)).toEqual({ restored: ['a.ts'], conflicts: [] });
    expect(await readFile(a, 'utf8')).toBe('a0');
    expect(await readFile(b, 'utf8')).toBe('b1');
    expect((await store.files('conv')).map((file) => file.display)).toEqual(['b.ts', 'new.ts']);

    expect(await store.revertFile('conv', created)).toEqual({ restored: ['new.ts'], conflicts: [] });
    expect(existsSync(created)).toBe(false);

    await writeFile(b, 'changed by the person', 'utf8');
    expect(await store.revertFile('conv', b)).toEqual({ restored: [], conflicts: ['b.ts'] });
    expect(await readFile(b, 'utf8')).toBe('changed by the person');
  });
});

describe('CheckpointStore — going back before a message', () => {
  /** A clock a second ahead at each turn's first write: the turns' order is their time. */
  function clocked(dir: string): CheckpointStore {
    let now = Date.parse('2026-11-15T10:00:00.000Z');
    return new CheckpointStore(dir, () => new Date((now += 1000)));
  }

  async function write(store: CheckpointStore, turn: string, path: string, display: string, content: string): Promise<void> {
    await store.before('conv', turn, path, display);
    await writeFile(path, content, 'utf8');
    await store.after('conv', turn, path);
  }

  async function threeTurns() {
    const store = clocked(await temp('bp-ckpt-data-'));
    const repo = await temp('bp-ckpt-repo-');
    const a = join(repo, 'a.ts');
    const b = join(repo, 'b.ts');
    const created = join(repo, 'new.ts');
    await writeFile(a, 'a0', 'utf8');
    await writeFile(b, 'b0', 'utf8');
    await write(store, 'turn-1', a, 'a.ts', 'a1'); // 10:00:01
    await write(store, 'turn-2', a, 'a.ts', 'a2'); // 10:00:02
    await write(store, 'turn-2', created, 'new.ts', 'fresh');
    await write(store, 'turn-3', b, 'b.ts', 'b3'); // 10:00:03
    return { store, a, b, created, since: '2026-11-15T10:00:01.500Z' };
  }

  it('undoes every change made since a moment, the latest first, across turns; what came before stays', async () => {
    const { store, a, b, created, since } = await threeTurns();
    const result = await store.undoSince('conv', since, 'rewind-1');
    expect([...result.restored].sort()).toEqual(['a.ts', 'b.ts', 'new.ts']);
    expect(result.conflicts).toEqual([]);
    expect(await readFile(a, 'utf8')).toBe('a1');
    expect(await readFile(b, 'utf8')).toBe('b0');
    expect(existsSync(created)).toBe(false);
    // The first turn's change still stands; the later ones are undone.
    expect((await store.files('conv')).map((file) => file.display)).toEqual(['a.ts']);
  });

  it('a file changed elsewhere since is left as it is, and named', async () => {
    const { store, a, b, since } = await threeTurns();
    await writeFile(b, 'the person’s own', 'utf8');
    const result = await store.undoSince('conv', since, 'rewind-1');
    expect(result.conflicts).toEqual(['b.ts']);
    expect(await readFile(b, 'utf8')).toBe('the person’s own');
    expect(await readFile(a, 'utf8')).toBe('a1');
  });

  it('what the going back put back can be undone: every file as before it, the turns standing again', async () => {
    const { store, a, b, created, since } = await threeTurns();
    await store.undoSince('conv', since, 'rewind-1');
    const redone = await store.redo('conv', 'rewind-1');
    expect([...redone.restored].sort()).toEqual(['a.ts', 'b.ts', 'new.ts']);
    expect(await readFile(a, 'utf8')).toBe('a2');
    expect(await readFile(b, 'utf8')).toBe('b3');
    expect(await readFile(created, 'utf8')).toBe('fresh');
    expect((await store.files('conv')).map((file) => file.display)).toEqual(['a.ts', 'new.ts', 'b.ts']);
  });
});
