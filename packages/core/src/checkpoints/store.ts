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
 * Going back before a message undoes, the latest first, every turn that
 * wrote since that moment — across the conversation's branches: the disk is
 * one. What it puts back is kept as a turn of its own, so that the going back
 * can be undone too.
 *
 * Layout: `<dir>/<conversation>/<turn>/manifest.json`, originals beside it.
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface Entry {
  path: string;
  display: string;
  /** The file existed before the turn (its original is stored); otherwise the turn created it. */
  existed: boolean;
  /** Stored original, relative to the turn folder. */
  blob?: string;
  /** Hash of the content the turn left — what undo expects to find. */
  afterHash?: string;
  /** Put back on its own (« Revenir »): no longer a change of the conversation. */
  reverted?: boolean;
}

interface Manifest {
  version: 1;
  entries: Entry[];
  undone: boolean;
  /** The turn's place among the conversation's turns, the first being 1. */
  seq?: number;
  /** When the turn first wrote (ISO): what « since a message » compares. */
  at?: string;
  /** A going back: what it put back is not a change of the conversation, and the turns it undid are named. */
  rewind?: { undid: string[] };
}

/** A file the conversation changed, across its turns. */
export interface ChangedFile {
  path: string;
  display: string;
  /** It did not exist before the conversation first wrote it. */
  created: boolean;
  /** When the last turn that changed it first wrote (ISO), when known. */
  lastAt?: string;
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
  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    await this.writeAt(this.turnDir(conversationId, turnId), manifest);
  }

  private async writeAt(dir: string, manifest: Manifest): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  /** The conversation's turns that changed something, in their order. */
  private async turns(conversationId: string): Promise<{ dir: string; manifest: Manifest }[]> {
    const base = join(this.dir, segment(conversationId));
    let names: string[];
    try {
      names = await readdir(base);
    } catch {
      return [];
    }
    const found: { dir: string; manifest: Manifest }[] = [];
    for (const name of names) {
      try {
        found.push({ dir: join(base, name), manifest: JSON.parse(await readFile(join(base, name, 'manifest.json'), 'utf8')) as Manifest });
      } catch {
        // Not a turn's folder.
      }
    }
    return found.sort((a, b) => (a.manifest.seq ?? 0) - (b.manifest.seq ?? 0));
  }

  /** The changes of a file that still stand: turns not undone, the file not put back on its own. */
  private async standing(conversationId: string): Promise<Map<string, { dir: string; manifest: Manifest; entry: Entry }[]>> {
    const byPath = new Map<string, { dir: string; manifest: Manifest; entry: Entry }[]>();
    for (const turn of await this.turns(conversationId)) {
      if (turn.manifest.undone || turn.manifest.rewind) continue;
      for (const entry of turn.manifest.entries) {
        if (entry.reverted) continue;
        const list = byPath.get(entry.path) ?? [];
        list.push({ ...turn, entry });
        byPath.set(entry.path, list);
      }
    }
    return byPath;
  }

  /** Before a tool writes `path`: keeps its original (or notes its absence), once per turn. */
  async before(conversationId: string, turnId: string, path: string, display: string): Promise<void> {
    const manifest = (await this.read(conversationId, turnId)) ?? {
      version: 1,
      entries: [],
      undone: false,
      seq: (await this.turns(conversationId)).length + 1,
      at: this.now().toISOString(),
    };
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
      if (entry.reverted) continue;
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

  /** What the conversation changed and still stands, each file once, in the order it was first written. */
  async files(conversationId: string): Promise<ChangedFile[]> {
    return [...(await this.standing(conversationId)).values()].map((changes) => {
      const first = changes[0]!.entry;
      const lastAt = changes.at(-1)!.manifest.at;
      return { path: first.path, display: first.display, created: !first.existed, ...(lastAt ? { lastAt } : {}) };
    });
  }

  /** A file as it was before the conversation first wrote it; null if it did not exist, undefined if not changed. */
  async original(conversationId: string, path: string): Promise<Buffer | null | undefined> {
    const first = (await this.standing(conversationId)).get(path)?.[0];
    if (!first) return undefined;
    if (!first.entry.existed || !first.entry.blob) return null;
    return readFile(join(first.dir, first.entry.blob));
  }

  /** « Revenir »: one file back to before the conversation wrote it — unless it changed since its last write. */
  async revertFile(conversationId: string, path: string): Promise<UndoResult> {
    const changes = (await this.standing(conversationId)).get(path);
    if (!changes || changes.length === 0) return { restored: [], conflicts: [] };
    const first = changes[0]!;
    const last = changes[changes.length - 1]!.entry;
    const now = await readBytes(path);
    if ((now === undefined ? undefined : hash(now)) !== last.afterHash) return { restored: [], conflicts: [last.display] };
    if (first.entry.existed && first.entry.blob) await writeFile(path, await readFile(join(first.dir, first.entry.blob)));
    else await rm(path, { force: true });
    for (const change of changes) {
      change.entry.reverted = true;
      await this.writeAt(change.dir, change.manifest);
    }
    return { restored: [first.entry.display], conflicts: [] };
  }

  /**
   * Going back before a message sent at `since`: every change made since,
   * the latest turn first, put back — a file changed elsewhere since is left
   * as it is and named. What it puts back is kept as the turn `asTurn`.
   */
  async undoSince(conversationId: string, since: string, asTurn: string, options: { except?: readonly string[] } = {}): Promise<UndoResult> {
    const own = this.turnDir(conversationId, asTurn);
    const later = (await this.since(conversationId, since, options.except)).filter((turn) => turn.dir !== own).reverse();
    const restored = new Set<string>();
    const conflicts = new Set<string>();
    const touched = new Map<string, string>();
    const undid: string[] = [];
    for (const turn of later) {
      for (const entry of turn.manifest.entries) {
        if (entry.reverted || conflicts.has(entry.display)) continue;
        const now = await readBytes(entry.path);
        if ((now === undefined ? undefined : hash(now)) !== entry.afterHash) {
          conflicts.add(entry.display);
          continue;
        }
        // What the file holds now, kept once: undoing the going back puts it back.
        if (!touched.has(entry.path)) {
          await this.before(conversationId, asTurn, entry.path, entry.display);
          touched.set(entry.path, entry.display);
        }
        if (entry.existed && entry.blob) await writeFile(entry.path, await readFile(join(turn.dir, entry.blob)));
        else await rm(entry.path, { force: true });
        restored.add(entry.display);
      }
      turn.manifest.undone = true;
      await this.writeAt(turn.dir, turn.manifest);
      undid.push(turn.dir);
    }
    for (const path of touched.keys()) await this.after(conversationId, asTurn, path);
    const manifest = (await this.read(conversationId, asTurn)) ?? { version: 1, entries: [], undone: false, at: this.now().toISOString() };
    manifest.rewind = { undid };
    await this.write(conversationId, asTurn, manifest);
    return { restored: [...restored], conflicts: [...conflicts].filter((name) => !restored.has(name)) };
  }

  /** The files changed since a moment and still standing — what going back in the conversation only leaves on disk. */
  async changedSince(conversationId: string, since: string, options: { except?: readonly string[] } = {}): Promise<string[]> {
    const names = new Set<string>();
    for (const turn of await this.since(conversationId, since, options.except)) {
      for (const entry of turn.manifest.entries) if (!entry.reverted) names.add(entry.display);
    }
    return [...names];
  }

  /**
   * The turns that wrote since a moment and still stand, in their order. `except`: turns known to come
   * before it (the person's earlier messages) — a clock tie never takes one of them.
   */
  private async since(conversationId: string, since: string, except: readonly string[] = []): Promise<{ dir: string; manifest: Manifest }[]> {
    const earlier = new Set(except.map(segment));
    return (await this.turns(conversationId)).filter(
      (turn) => !turn.manifest.undone && !turn.manifest.rewind && !earlier.has(basename(turn.dir)) && (turn.manifest.at ?? '') >= since,
    );
  }

  /** « Annuler le retour »: the files as they were before the going back, and the turns it undid standing again. */
  async redo(conversationId: string, asTurn: string): Promise<UndoResult> {
    const manifest = await this.read(conversationId, asTurn);
    if (!manifest?.rewind || manifest.undone) return { restored: [], conflicts: [] };
    const result = await this.undo(conversationId, asTurn);
    for (const dir of manifest.rewind.undid) {
      try {
        const undone = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
        undone.undone = false;
        await this.writeAt(dir, undone);
      } catch {
        // A turn forgotten since: nothing to stand again.
      }
    }
    return result;
  }

  /** A deleted conversation takes its checkpoints with it. */
  async forget(conversationId: string): Promise<void> {
    await rm(join(this.dir, segment(conversationId)), { recursive: true, force: true });
  }
}
