/**
 * The small JSON files bonaparte keeps — a conversation's meta, the app's
 * config, the MCP servers — are read by one part while another rewrites
 * them. Two rules, kept here once:
 *
 * - a reader never takes a half-written file for an empty one: files are
 *   written beside and renamed over; when Windows refuses the rename (a
 *   reader holds the file at that instant — and a busy one can keep
 *   refusing it), the file is written in place and readers retry a torn
 *   read for a moment. A writer is often a turn: it must not fail for a
 *   reader;
 * - a read-modify-write runs alone on its file (`KeyedQueue`), or two of
 *   them lose each other's change.
 */

import { readFile, rename, rm, writeFile } from 'node:fs/promises';

let sequence = 0;

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${path}.${process.pid}.${++sequence}.tmp`;
  await writeFile(temp, content, 'utf8');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(temp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
        await rm(temp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
  await writeFile(path, content, 'utf8');
  await rm(temp, { force: true });
}

/**
 * The parsed file. A missing file rejects with its ENOENT — the caller says
 * what absence means; a torn read is retried for a moment; a file that
 * stays unreadable rejects with the parse error.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const raw = decode(await readFile(path));
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

/**
 * Text as Windows editors save it: UTF-8 with or without a BOM (Notepad,
 * PowerShell 5's `Set-Content -Encoding utf8`), or UTF-16 LE with its BOM
 * (PowerShell's `>`). A file the user edited by hand must read as written.
 */
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8');
  return bytes.toString('utf8');
}

/** One task at a time per key, in the order they came; a failure does not block the next. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
