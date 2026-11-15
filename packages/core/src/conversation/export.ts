/**
 * « Exporter les conversations… » (task 5.9): one Markdown file per
 * conversation — its title, then who said what, in order, as the journal
 * holds it (the answers' text; their reasoning and their tool calls stay
 * out). The export goes into a folder of its own, `bonaparte-<date>`, made
 * for it: it never writes over a file the person kept. The words that name
 * the person and the assistant are the window's, in its language.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FamilyLayer } from '../families/types.js';
import { openJournal } from '../journal/journal.js';
import { projectToAparte } from '../journal/projection.js';
import type { ConversationStore } from './store.js';

export interface ExportOptions {
  store: ConversationStore;
  family: () => FamilyLayer;
  /** The folder the person chose: the export makes its own inside it. */
  into: string;
  labels: { person: string; assistant: string; untitled: string };
  /** The day of the export, `YYYY-MM-DD`: the name of its folder. */
  date: string;
}

/** Characters no file name may hold on Windows, and the control characters. */
const NOT_IN_A_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;
const MAX_NAME = 80;

function fileName(title: string, taken: Set<string>): string {
  const base = title.replace(NOT_IN_A_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, MAX_NAME) || 'conversation';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  taken.add(name.toLowerCase());
  return `${name}.md`;
}

/** A new folder: `bonaparte-<date>`, or `bonaparte-<date> (2)`… when that one is there already. */
async function newFolder(into: string, date: string): Promise<string> {
  for (let n = 1; ; n++) {
    const folder = join(into, n === 1 ? `bonaparte-${date}` : `bonaparte-${date} (${n})`);
    try {
      await mkdir(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export async function exportConversations(options: ExportOptions): Promise<{ folder: string; count: number }> {
  const folder = await newFolder(options.into, options.date);
  const taken = new Set<string>();
  let count = 0;
  for (const meta of await options.store.list()) {
    const journal = await openJournal(options.store.dir, meta.id, meta.branchId);
    const projected = projectToAparte(meta, journal.entries(), options.family());
    const title = meta.title || options.labels.untitled;
    const lines = [`# ${title}`, ''];
    for (const message of projected.messages) {
      lines.push(`**${message.role === 'user' ? options.labels.person : options.labels.assistant}**`, '', message.content, '');
    }
    await writeFile(join(folder, fileName(title, taken)), lines.join('\n'), { encoding: 'utf8', flag: 'wx' });
    count += 1;
  }
  return { folder, count };
}
