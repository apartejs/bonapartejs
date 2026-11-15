/**
 * The branches of a conversation (task 7.2, « Brancher »). A branch is made
 * by going back before a message, by a message changed, or by an answer
 * asked again; each one shares the start of the branch it came from and
 * parts somewhere — at a message of its own, or at another answer.
 *
 * One branch is shown at a time. Showing another keeps the window's
 * document of the one left and gives back the other's — or none, and the
 * journal is read again. The answer the person picks among siblings in the
 * chat is followed: the branch whose last answer it is becomes the shown one,
 * its document unchanged (the chat's tree holds both).
 */

import type { FamilyLayer } from '../families/types.js';
import { openJournal } from '../journal/journal.js';
import type { JournalEntry } from '../journal/types.js';
import type { ConversationEngine } from './engine.js';
import type { ConversationStore } from './store.js';

export interface BranchView {
  branchId: string;
  /** The branch shown and continued. */
  active: boolean;
  at: string;
  /** How many of the person's messages it shares with the branch it came from. */
  userIndex: number;
  /** Where it parts: a message of its own, another answer to a shared one, or nothing yet. */
  startsWith: 'message' | 'answer' | 'nothing';
  /** What it says where it parts — an excerpt; empty when it says nothing yet. */
  label: string;
  /** The person's messages it holds. */
  messages: number;
}

export interface BranchesDeps {
  engine: ConversationEngine;
  store: ConversationStore;
  family(): FamilyLayer;
}

const excerpt = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** What an answer says, without its reasoning nor its calls. */
function answerText(raw: string, family: FamilyLayer): string {
  const demux = family.createDemux();
  return [...demux.push(raw), ...demux.flush()]
    .map((event) => (event.type === 'text' ? event.text : ''))
    .join('');
}

export function createBranches(deps: BranchesDeps) {
  const read = async (id: string, branchId: string): Promise<readonly JournalEntry[]> =>
    (await openJournal(deps.store.dir, id, branchId)).entries();

  return {
    /** Every branch of the conversation that says something of its own, and the one shown. */
    async list(id: string): Promise<BranchView[]> {
      const meta = await deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const views: BranchView[] = [];
      for (const branch of await (await openJournal(deps.store.dir, id, meta.branchId)).branches()) {
        const entries = await read(id, branch.branchId);
        const at = branch.forkedAfter === null ? -1 : entries.findIndex((entry) => entry.id === branch.forkedAfter);
        const shared = entries.slice(0, at + 1);
        const own = entries.slice(at + 1);
        const first = own.find((entry) => entry.kind === 'user' || entry.kind === 'assistant');
        const active = branch.branchId === meta.branchId;
        if (!first && !active) continue;
        views.push({
          branchId: branch.branchId,
          active,
          at: branch.at,
          userIndex: shared.filter((entry) => entry.kind === 'user').length,
          startsWith: !first ? 'nothing' : first.kind === 'user' ? 'message' : 'answer',
          label: !first ? '' : excerpt(first.kind === 'user' ? first.text : first.kind === 'assistant' ? answerText(first.raw, deps.family()) : ''),
          messages: entries.filter((entry) => entry.kind === 'user').length,
        });
      }
      return views;
    },

    /** « Brancher »: another branch shown; the window's document of the one left kept, the other's given back. */
    async switchTo(id: string, branchId: string): Promise<void> {
      const meta = await deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      if (meta.branchId === branchId) return;
      await deps.engine.switchBranch(id, branchId);
      await deps.store.keepDocument(id, meta.branchId);
      await deps.store.takeDocument(id, branchId);
    },

    /**
     * The sibling answer the person picked in the chat (`messageIds`: the window's messages of the path
     * shown): the branch whose last answer is the path's last becomes the one shown. Null when none is.
     */
    async follow(id: string, messageIds: readonly string[]): Promise<string | null> {
      const meta = await deps.store.get(id);
      const last = messageIds.at(-1);
      if (!meta || !last) return null;
      for (const branch of await (await openJournal(deps.store.dir, id, meta.branchId)).branches()) {
        const answer = (await read(id, branch.branchId)).findLast((entry) => entry.kind === 'assistant');
        if (answer?.messageId !== last) continue;
        if (branch.branchId !== meta.branchId) await deps.engine.switchBranch(id, branch.branchId);
        return branch.branchId;
      }
      return null;
    },
  };
}

export type Branches = ReturnType<typeof createBranches>;
