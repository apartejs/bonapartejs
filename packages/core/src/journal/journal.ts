/**
 * The journal of a conversation, on disk: one JSONL file per branch, under
 * `<dir>/<conversationId>/`, appended and never rewritten, and the list of
 * the branches beside it (`branches.json`).
 *
 * - A line is written whole and flushed before `append` resolves; the writes
 *   of one branch go one after the other, in the order they were asked.
 * - A line cut by a power failure is the last one: it is dropped when the
 *   journal is opened, and the file is cut back to the last whole line, so
 *   that what is appended next is not glued to it.
 * - A branch copies the entries it shares with the one it comes from: each
 *   file holds its whole branch, and a branch is never touched by another.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { isRefrozen, type BranchInfo, type Journal, type JournalEntry, type NewJournalEntry } from './types.js';

export type * from './types.js';
export { isRefrozen } from './types.js';

const writes = new KeyedQueue();
/** Ids become file names: letters, digits, `-` and `_` only. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAIN = 'main';

/**
 * The prompt a branch froze, from what was written — never rendered again:
 * the `rendered` texts from the last rebase or change of model (or from the
 * system entry).
 */
export function frozenPrompt(entries: readonly JournalEntry[]): string {
  let start = entries.findLastIndex(isRefrozen);
  if (start < 0) start = Math.max(0, entries.findIndex((entry) => entry.kind === 'system'));
  return entries
    .slice(start)
    .map((entry) => entry.rendered ?? '')
    .join('');
}

/** Reads a branch's file; a last line cut in the middle is dropped, and the file cut back to the line before. */
async function readBranch(file: string): Promise<JournalEntry[]> {
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const end = content.lastIndexOf(0x0a) + 1;
  if (end < content.length) await truncate(file, end);
  const lines = content.subarray(0, end).toString('utf8').split('\n');
  const entries: JournalEntry[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // A whole line that does not read is not a power cut: the journal is not opened on a guess.
      throw new Error(`The journal ${file} cannot be read at line ${index + 1}.`);
    }
  });
  return entries;
}

class FileJournal implements Journal {
  constructor(
    private readonly dir: string,
    readonly conversationId: string,
    readonly branchId: string,
    private readonly all: JournalEntry[],
  ) {}

  private get folder(): string {
    return join(this.dir, this.conversationId);
  }

  private get file(): string {
    return join(this.folder, `${this.branchId}.jsonl`);
  }

  entries(): readonly JournalEntry[] {
    const withdrawn = new Set(this.all.flatMap((entry) => (entry.kind === 'withdrawn' ? [entry.entryId] : [])));
    return this.all.filter((entry) => entry.kind !== 'withdrawn' && !withdrawn.has(entry.id));
  }

  append(entry: NewJournalEntry): Promise<JournalEntry> {
    const written = { id: randomUUID(), at: new Date().toISOString(), ...entry } as JournalEntry;
    const line = `${JSON.stringify(written)}\n`;
    // Queued at once, before any await: the order of the calls is the order of the lines.
    return writes.run(this.file, async () => {
      const handle = await open(this.file, 'a');
      try {
        const data = Buffer.from(line, 'utf8');
        const before = (await handle.stat()).size;
        try {
          // A disk may take less than asked: the rest is written until the line is whole.
          for (let offset = 0; offset < data.length; ) {
            const { bytesWritten } = await handle.write(data, offset, data.length - offset);
            if (bytesWritten <= 0) throw new Error(`The journal ${this.file} could not be written: the disk took nothing.`);
            offset += bytesWritten;
          }
          await handle.datasync();
        } catch (error) {
          // What went half-way is taken back: the next line is never glued to it. By its path: a file
          // opened to append cannot be cut through that handle on Windows.
          await truncate(this.file, before).catch(() => undefined);
          throw error;
        }
      } finally {
        await handle.close();
      }
      this.all.push(written);
      return written;
    });
  }

  async fork(afterEntryId: string): Promise<Journal> {
    const index = this.all.findIndex((entry) => entry.id === afterEntryId);
    if (index < 0 || !this.entries().some((entry) => entry.id === afterEntryId)) {
      throw new Error(`The branch ${this.branchId} has no entry ${afterEntryId}.`);
    }
    const branchId = `b-${randomUUID().slice(0, 8)}`;
    const shared = this.all.slice(0, index + 1);
    const file = join(this.folder, `${branchId}.jsonl`);
    await writes.run(file, () => writeFile(file, shared.map((entry) => `${JSON.stringify(entry)}\n`).join(''), { flag: 'wx' }));
    const list = join(this.folder, 'branches.json');
    await writes.run(list, async () => {
      const known = await listBranches(this.folder);
      await writeJsonFile(list, [...known, { branchId, forkedAfter: afterEntryId, from: this.branchId, at: new Date().toISOString() }]);
    });
    return openJournal(this.dir, this.conversationId, branchId);
  }

  branches(): Promise<readonly BranchInfo[]> {
    return listBranches(this.folder);
  }
}

async function listBranches(folder: string): Promise<BranchInfo[]> {
  try {
    return (await readJsonFile(join(folder, 'branches.json'))) as BranchInfo[];
  } catch {
    return [{ branchId: MAIN, forkedAfter: null, from: null, at: new Date(0).toISOString() }];
  }
}

export async function openJournal(dir: string, conversationId: string, branchId = MAIN): Promise<Journal> {
  if (!ID.test(conversationId)) throw new Error(`Not a conversation id: ${conversationId}`);
  if (!ID.test(branchId)) throw new Error(`Not a branch id: ${branchId}`);
  const folder = join(dir, conversationId);
  await mkdir(folder, { recursive: true });
  const list = join(folder, 'branches.json');
  await writes.run(list, async () => {
    const known = await readJsonFile(list).catch(() => null);
    if (!known) await writeJsonFile(list, [{ branchId: MAIN, forkedAfter: null, from: null, at: new Date().toISOString() }]);
  });
  if (branchId !== MAIN && !(await listBranches(folder)).some((branch) => branch.branchId === branchId)) {
    throw new Error(`The conversation ${conversationId} has no branch ${branchId}.`);
  }
  const file = join(folder, `${branchId}.jsonl`);
  const entries = await writes.run(file, () => readBranch(file));
  return new FileJournal(dir, conversationId, branchId, entries);
}

/**
 * A conversation that starts from another's branch (« Brancher sur ce modèle », task 7.4): that branch's
 * entries, as they were written, become the main branch of `toConversationId` — a journal that has none yet.
 */
export async function copyJournal(dir: string, from: { conversationId: string; branchId: string }, toConversationId: string): Promise<Journal> {
  const source = await openJournal(dir, from.conversationId, from.branchId);
  const target = await openJournal(dir, toConversationId);
  if (target.entries().length > 0) throw new Error(`The conversation ${toConversationId} already has a journal.`);
  const file = join(dir, toConversationId, `${MAIN}.jsonl`);
  const lines = source.entries().map((entry) => `${JSON.stringify(entry)}\n`).join('');
  await writes.run(file, () => writeFile(file, lines));
  return openJournal(dir, toConversationId);
}
