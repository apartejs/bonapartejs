/**
 * Checkpoints — what a turn changed on disk, so it can be taken back:
 * copies in the app's data, never commits or files in the user's
 * repository.
 *
 * Before a tool writes a file, its original — or its absence — is kept
 * once per turn; after the write, the new content's hash is noted. Undo
 * puts every original back (a file the turn created is removed), except a
 * file changed again since the turn: that one is left alone and named — an
 * undo never overwrites work done after it.
 *
 * Layout: `<dir>/<conversation>/<turn>/manifest.json`, originals beside it.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Entry {
  path: string;
  display: string;
  /** The file existed before the turn (its original is stored); otherwise the turn created it. */
  existed: boolean;
  /** Stored original, relative to the turn folder. */
  blob?: string;
  /** Hash of the content the turn left — what undo expects to find. */
  afterHash?: string;
}

interface Manifest {
  version: 1;
  entries: Entry[];
  undone: boolean;
}

export interface TurnChanges {
  /** The files the turn wrote, as the tools showed them. */
  files: string[];
  undone: boolean;
}

export interface UndoResult {
  restored: string[];
  /** Files changed again since the turn: left as they are. */
  conflicts: string[];
}

const hash = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

async function readBytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/** A path segment safe as a folder name (ids are ours, but never trust a separator — nor a `..`). */
const segment = (value: string): string => value.replace(/[^\w-]/g, '_') || '_';

export class CheckpointStore {
  constructor(readonly dir: string) {}

  private turnDir(conversationId: string, turnId: string): string {
    return join(this.dir, segment(conversationId), segment(turnId));
  }

  private async read(conversationId: string, turnId: string): Promise<Manifest | undefined> {
    try {
      return JSON.parse(await readFile(join(this.turnDir(conversationId, turnId), 'manifest.json'), 'utf8')) as Manifest;
    } catch {
      return undefined;
    }
  }

  private async write(conversationId: string, turnId: string, manifest: Manifest): Promise<void> {
    const dir = this.turnDir(conversationId, turnId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  /** Before a tool writes `path`: keeps its original (or notes its absence), once per turn. */
  async before(conversationId: string, turnId: string, path: string, display: string): Promise<void> {
    const manifest = (await this.read(conversationId, turnId)) ?? { version: 1, entries: [], undone: false };
    if (manifest.entries.some((entry) => entry.path === path)) return;
    const original = await readBytes(path);
    const entry: Entry = { path, display, existed: original !== undefined };
    if (original !== undefined) {
      entry.blob = `${manifest.entries.length}.orig`;
      await mkdir(this.turnDir(conversationId, turnId), { recursive: true });
      await writeFile(join(this.turnDir(conversationId, turnId), entry.blob), original);
    }
    manifest.entries.push(entry);
    await this.write(conversationId, turnId, manifest);
  }

  /** After the write: the content the turn left, to recognise a later change. */
  async after(conversationId: string, turnId: string, path: string): Promise<void> {
    const manifest = await this.read(conversationId, turnId);
    const entry = manifest?.entries.find((candidate) => candidate.path === path);
    if (!manifest || !entry) return;
    const now = await readBytes(path);
    if (now === undefined) delete entry.afterHash;
    else entry.afterHash = hash(now);
    await this.write(conversationId, turnId, manifest);
  }

  /** What a turn changed; undefined when it wrote nothing. */
  async changes(conversationId: string, turnId: string): Promise<TurnChanges | undefined> {
    const manifest = await this.read(conversationId, turnId);
    if (!manifest || manifest.entries.length === 0) return undefined;
    return { files: manifest.entries.map((entry) => entry.display), undone: manifest.undone };
  }

  /** Puts the turn's originals back, except files changed again since. */
  async undo(conversationId: string, turnId: string): Promise<UndoResult> {
    const manifest = await this.read(conversationId, turnId);
    if (!manifest || manifest.undone) return { restored: [], conflicts: [] };
    const restored: string[] = [];
    const conflicts: string[] = [];
    for (const entry of manifest.entries) {
      const now = await readBytes(entry.path);
      const nowHash = now === undefined ? undefined : hash(now);
      if (nowHash !== entry.afterHash) {
        conflicts.push(entry.display);
        continue;
      }
      if (entry.existed && entry.blob) {
        const original = await readFile(join(this.turnDir(conversationId, turnId), entry.blob));
        await writeFile(entry.path, original);
      } else {
        await rm(entry.path, { force: true });
      }
      restored.push(entry.display);
    }
    manifest.undone = true;
    await this.write(conversationId, turnId, manifest);
    return { restored, conflicts };
  }

  /** A deleted conversation takes its checkpoints with it. */
  async forget(conversationId: string): Promise<void> {
    await rm(join(this.dir, segment(conversationId)), { recursive: true, force: true });
  }
}
