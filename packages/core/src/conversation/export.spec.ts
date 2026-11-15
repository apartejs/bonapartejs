/**
 * « Exporter les conversations… » (task 5.9): one Markdown file per
 * conversation — its title, then who said what, in order — in a folder of its
 * own, so that an export never writes over a file the person kept.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import { exportConversations } from './export.js';
import { ConversationStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function conversation(store: ConversationStore, title: string, said: [string, string][]) {
  const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition', title });
  const journal = await openJournal(store.dir, meta.id, meta.branchId);
  for (const [user, answer] of said) {
    await journal.append({ kind: 'user', text: user, rendered: '' });
    await journal.append({ kind: 'assistant', raw: answer, rendered: '' });
  }
  return meta;
}

const LABELS = { person: 'Toi', assistant: 'bonaparte', untitled: 'Nouvelle conversation' };
const options = (store: ConversationStore, into: string) => ({
  store,
  family: () => familyLayer('gemma'),
  into,
  labels: LABELS,
  date: '2026-11-15',
});

describe('exportConversations', () => {
  it('writes one Markdown file per conversation: its title, then who said what, in order', async () => {
    const store = new ConversationStore(await folder('bp-export-'));
    await conversation(store, 'Les heures', [
      ['Le parseur des heures se trompe', '<|channel>thought\nHmm.<channel|>Je regarde toDecimal.'],
      ['Et les fuseaux ?', 'Aussi.'],
    ]);
    await conversation(store, 'Export CSV', [['Ajoute un export', 'Fait.']]);
    const into = await folder('bp-export-into-');

    const done = await exportConversations(options(store, into));

    expect(done.count).toBe(2);
    expect(done.folder).toBe(join(into, 'bonaparte-2026-11-15'));
    const files = (await readdir(done.folder)).sort();
    expect(files).toHaveLength(2);
    const hours = files.find((file) => file.startsWith('Les heures'))!;
    expect(hours).toMatch(/\.md$/);
    expect(await readFile(join(done.folder, hours), 'utf8')).toBe(
      [
        '# Les heures',
        '',
        '**Toi**',
        '',
        'Le parseur des heures se trompe',
        '',
        '**bonaparte**',
        '',
        'Je regarde toDecimal.',
        '',
        '**Toi**',
        '',
        'Et les fuseaux ?',
        '',
        '**bonaparte**',
        '',
        'Aussi.',
        '',
      ].join('\n'),
    );
  });

  it('never writes over an earlier export: each goes into a folder of its own', async () => {
    const store = new ConversationStore(await folder('bp-export-'));
    await conversation(store, 'Une', [['a', 'b']]);
    const into = await folder('bp-export-into-');
    const first = await exportConversations(options(store, into));
    const second = await exportConversations(options(store, into));
    expect(second.folder).not.toBe(first.folder);
    expect(await readdir(second.folder)).toHaveLength(1);
  });

  it('makes a file name of any title, and keeps two titles alike apart', async () => {
    const store = new ConversationStore(await folder('bp-export-'));
    await conversation(store, 'a/b:c*?"<>|', [['x', 'y']]);
    await conversation(store, 'Pareil', [['x', 'y']]);
    await conversation(store, 'Pareil', [['x', 'y']]);
    await conversation(store, '', [['x', 'y']]);
    const into = await folder('bp-export-into-');
    const done = await exportConversations(options(store, into));
    const files = await readdir(done.folder);
    expect(files).toHaveLength(4);
    expect(files).toContain('Nouvelle conversation.md');
    for (const file of files) expect(file).not.toMatch(/[\\/:*?"<>|]/);
  });
});
