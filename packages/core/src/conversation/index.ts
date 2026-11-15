/**
 * What « Rechercher » (Ctrl K) finds (task 5.8): the conversations where a
 * word was said — by the person, or in an answer's text —, each with the
 * passage around it; and the files of the project whose name holds it. The
 * conversations' text is read from their journals once, kept in memory, and
 * refreshed when a turn ends; the files are walked at each search, never in
 * the folders a build or a package manager made.
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FamilyLayer } from '../families/types.js';
import { openJournal } from '../journal/journal.js';
import { SKIPPED_FOLDERS } from '../tools/builtin/common.js';
import type { ConversationStore } from './store.js';

export interface FoundConversation {
  id: string;
  title: string;
  /** The passage around the first place the words stand: before, the words as written, after. */
  excerpt: { before: string; match: string; after: string };
}

export interface SearchResult {
  conversations: FoundConversation[];
  files: { path: string }[];
}

const AROUND = 48;
const MAX_CONVERSATIONS = 20;
const MAX_FILES = 20;
/** Files looked at in one search, at most: a huge folder is cut short, never walked whole. */
const MAX_WALKED = 20_000;

export class ConversationIndex {
  private texts: Map<string, { title: string; text: string }> | null = null;

  constructor(
    private readonly store: ConversationStore,
    /** The family whose demux reads the answers' text. */
    private readonly family: () => FamilyLayer,
  ) {}

  /** A conversation's text, read again from its journal: a turn that ended, a title that changed. */
  async refresh(id: string): Promise<void> {
    if (!this.texts) return;
    const read = await this.read(id);
    if (read) this.texts.set(id, read);
    else this.texts.delete(id);
  }

  async search(query: string, options: { roots?: readonly string[] } = {}): Promise<SearchResult> {
    const words = query.trim();
    if (words === '') return { conversations: [], files: [] };
    const needle = words.toLowerCase();
    const texts = await this.all();
    const conversations: FoundConversation[] = [];
    for (const [id, { title, text }] of texts) {
      const inTitle = title.toLowerCase().indexOf(needle);
      const inText = text.toLowerCase().indexOf(needle);
      if (inTitle < 0 && inText < 0) continue;
      const [source, at] = inText >= 0 ? [text, inText] : [title, inTitle];
      // The passage stays in its line: one message's words, never the next message's.
      const lineStart = source.lastIndexOf('\n', at) + 1;
      const end = at + words.length;
      const lineEnd = source.indexOf('\n', end);
      const stop = lineEnd < 0 ? source.length : lineEnd;
      conversations.push({
        id,
        title,
        excerpt: {
          before: source.slice(Math.max(lineStart, at - AROUND), at).replace(/\s+/g, ' ').trimStart(),
          match: source.slice(at, end),
          after: source.slice(end, Math.min(stop, end + AROUND)).replace(/\s+/g, ' ').trimEnd(),
        },
      });
      if (conversations.length >= MAX_CONVERSATIONS) break;
    }
    const files = options.roots ? await this.files(options.roots, needle) : [];
    return { conversations, files };
  }

  private async all(): Promise<Map<string, { title: string; text: string }>> {
    if (this.texts) return this.texts;
    const texts = new Map<string, { title: string; text: string }>();
    for (const meta of await this.store.list()) {
      const read = await this.read(meta.id);
      if (read) texts.set(meta.id, read);
    }
    this.texts = texts;
    return texts;
  }

  private async read(id: string): Promise<{ title: string; text: string } | null> {
    const meta = await this.store.get(id);
    if (!meta) return null;
    const journal = await openJournal(this.store.dir, id, meta.branchId);
    const family = this.family();
    const parts: string[] = [];
    for (const entry of journal.entries()) {
      if (entry.kind === 'user') parts.push(entry.text);
      else if (entry.kind === 'assistant') {
        const demux = family.createDemux();
        parts.push([...demux.push(entry.raw), ...demux.flush()].map((piece) => (piece.type === 'text' ? piece.delta : '')).join(''));
      }
    }
    return { title: meta.title, text: parts.join('\n') };
  }

  private async files(roots: readonly string[], needle: string): Promise<{ path: string }[]> {
    const found: { path: string }[] = [];
    let walked = 0;
    const walk = async (root: string, dir: string): Promise<void> => {
      if (found.length >= MAX_FILES || walked >= MAX_WALKED) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (found.length >= MAX_FILES || walked >= MAX_WALKED) return;
        walked += 1;
        if (entry.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(entry.name)) await walk(root, join(dir, entry.name));
        } else if (entry.isFile() && entry.name.toLowerCase().includes(needle)) {
          const shown = relative(root, join(dir, entry.name)).replace(/\\/g, '/');
          found.push({ path: roots.length > 1 ? `${root}/${shown}` : shown });
        }
      }
    };
    for (const root of roots) await walk(root, root);
    return found;
  }
}
