/**
 * What « Rechercher » (Ctrl K) finds (task 5.8): the conversations where a
 * word was said — by the person or in an answer —, with the passage around
 * it; and the files of the project whose name holds it. The index follows
 * the conversations: a turn that ends is found at once.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import { ConversationIndex } from './index.js';
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

describe('ConversationIndex', () => {
  it('finds the conversation where a word was said, with the passage around it', async () => {
    const store = new ConversationStore(await folder('bp-index-'));
    const hours = await conversation(store, 'Les heures', [['Le parseur des heures se trompe', 'Je regarde toDecimal dans le parseur.']]);
    await conversation(store, 'Autre chose', [['Bonjour', 'ok']]);
    const index = new ConversationIndex(store, () => familyLayer('gemma'));
    const found = await index.search('PARSEUR');
    expect(found.conversations.map((one) => one.id)).toEqual([hours.id]);
    const excerpt = found.conversations[0]!.excerpt;
    expect(excerpt.match.toLowerCase()).toBe('parseur');
    expect(`${excerpt.before}${excerpt.match}${excerpt.after}`).toContain('Le parseur des heures');
    expect(found.conversations[0]!.title).toBe('Les heures');
  });

  it('keeps the passage inside the message where the words were said', async () => {
    const store = new ConversationStore(await folder('bp-index-'));
    await conversation(store, 'Les heures', [['Le parseur des heures se trompe', 'Je regarde.']]);
    const index = new ConversationIndex(store, () => familyLayer('gemma'));
    const excerpt = (await index.search('heures se')).conversations[0]!.excerpt;
    expect(excerpt.before).toBe('Le parseur des ');
    expect(excerpt.after).toBe(' trompe');
  });

  it('a turn that ends is found at once', async () => {
    const store = new ConversationStore(await folder('bp-index-'));
    const meta = await conversation(store, 'Vide', []);
    const index = new ConversationIndex(store, () => familyLayer('gemma'));
    expect((await index.search('fuseau')).conversations).toEqual([]);
    const journal = await openJournal(store.dir, meta.id, meta.branchId);
    await journal.append({ kind: 'user', text: 'Et les fuseaux horaires ?', rendered: '' });
    await index.refresh(meta.id);
    expect((await index.search('fuseau')).conversations.map((one) => one.id)).toEqual([meta.id]);
  });

  it("finds the project's files by their name — never in node_modules", async () => {
    const store = new ConversationStore(await folder('bp-index-'));
    const project = await folder('bp-index-project-');
    await mkdir(join(project, 'src', 'recap'), { recursive: true });
    await mkdir(join(project, 'node_modules', 'csv'), { recursive: true });
    await writeFile(join(project, 'src', 'recap', 'csv.ts'), '');
    await writeFile(join(project, 'node_modules', 'csv', 'index.js'), '');
    await writeFile(join(project, 'README.md'), '');
    const index = new ConversationIndex(store, () => familyLayer('gemma'));
    const found = await index.search('csv', { roots: [project] });
    expect(found.files).toEqual([{ path: 'src/recap/csv.ts' }]);
  });

  it('an empty search finds nothing', async () => {
    const store = new ConversationStore(await folder('bp-index-'));
    await conversation(store, 'x', [['a', 'b']]);
    expect(await new ConversationIndex(store, () => familyLayer('gemma')).search('   ')).toEqual({ conversations: [], files: [] });
  });
});
