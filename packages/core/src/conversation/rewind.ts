/**
 * Going back before a message (task 7.1, board « Revenir en arrière »).
 *
 * - The code and the conversation (« Le code et la conversation »): the files
 *   as they were before the message, and the conversation on a new branch
 *   that starts before it.
 * - The conversation only: a new branch, the files as they are.
 * - The code only: the files back, the conversation on its branch.
 *
 * What followed is never lost: it stays in the branch left, with its saved
 * memory. A command already run is not undone: it is named. What the model
 * must know of it — the files it did not see change — is a note at its next
 * turn, in English. Until that turn begins, the going back can be undone.
 */

import { randomUUID } from 'node:crypto';
import type { CheckpointStore } from '../checkpoints/store.js';
import type { RereadAnnouncement } from '../costs/announce.js';
import type { FamilyLayer } from '../families/types.js';
import type { JournalEntry } from '../journal/types.js';
import { RewindTargetError, type ConversationEngine, type RewindLook, type RewindTarget } from './engine.js';
import type { ConversationStore } from './store.js';
import { writersOf } from './switch.js';

export { RewindTargetError, type RewindTarget };

export type RewindWhat = 'both' | 'conversation' | 'code';

export interface RewindResult {
  /** The branch shown and continued from now on. */
  branchId: string;
  fromBranchId: string;
  /** The message gone back before: what the composer is given back. */
  text: string;
  filesRestored: string[];
  /** Files changed elsewhere since: left as they are. */
  conflicts: string[];
  /** Commands run after the message: a command does not undo. */
  commandsNotUndone: string[];
  /** What the conversation's memory will cost at its next turn: kept, read again (said), or none to keep. */
  memory: 'kept' | RereadAnnouncement | null;
}

/** What going back before a message would move, said before the person decides. */
export interface RewindPreview {
  /** The files changed since the message: what « le code » puts back, what « la conversation seulement » leaves. */
  files: string[];
  /** Commands run since: none of them is undone. */
  commands: string[];
  /** What the memory will cost, for the conversation (not for the code only): kept, or read again. */
  memory: 'kept' | RereadAnnouncement | null;
}

export interface RewindDeps {
  engine: ConversationEngine;
  checkpoints: CheckpointStore;
  store: ConversationStore;
  /** The family the conversation's answers are written in: what reads their calls. */
  family(): FamilyLayer;
}

/** The commands run after the message: each `run_command` call answered by a result that did not fail. */
export function commandsRun(after: readonly JournalEntry[], family: FamilyLayer, branch: readonly JournalEntry[] = after): string[] {
  // Each call read by the family that wrote it: a change of model may stand between them (review of phase 7).
  const writers = writersOf(branch, family);
  const calls: string[] = [];
  const ran: boolean[] = [];
  for (const entry of after) {
    if (entry.kind === 'assistant') {
      const demux = (writers.get(entry.id) ?? family).createDemux();
      for (const event of [...demux.push(entry.raw), ...demux.flush()]) {
        if (event.type !== 'tool-call' || event.name !== 'run_command') continue;
        const program = typeof event.input['program'] === 'string' ? event.input['program'] : '';
        const args = Array.isArray(event.input['args']) ? event.input['args'].filter((arg): arg is string => typeof arg === 'string') : [];
        if (program) calls.push([program, ...args].join(' '));
      }
    }
    if (entry.kind === 'tool-results') {
      for (const result of entry.results) if (result.name === 'run_command') ran.push(!result.failed);
    }
  }
  return [...new Set(calls.filter((_, index) => ran[index] === true))];
}

const excerpt = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** What the model is told at its next turn — English, said once; nothing when it has nothing to learn. */
export function rewindNote(
  what: RewindWhat,
  facts: { message: string; restored: readonly string[]; conflicts: readonly string[]; kept: readonly string[]; commands: readonly string[] },
): string | undefined {
  const said: string[] = [];
  const quoted = `“${excerpt(facts.message)}”`;
  if (what === 'code') {
    if (facts.restored.length > 0) said.push(`The user put the files back to how they were before their message ${quoted}: ${facts.restored.join(', ')} are back to that state.`);
    if (facts.conflicts.length > 0) said.push(`Left as they are, because they changed since: ${facts.conflicts.join(', ')}.`);
  } else if (what === 'conversation' && facts.kept.length > 0) {
    said.push(
      `The user went back before their message ${quoted}: the conversation continues from there. ` +
        `The files were not put back: they keep the changes made after that point (${facts.kept.join(', ')}).`,
    );
  } else if (what === 'both' && facts.conflicts.length > 0) {
    said.push(`The files were put back to how they were before that point, except these, changed since: ${facts.conflicts.join(', ')}.`);
  }
  if (facts.commands.length > 0) {
    if (said.length === 0 && what !== 'code') said.push(`The user went back before their message ${quoted}: the conversation continues from there.`);
    said.push(`Commands run after that point were not undone: ${facts.commands.join(', ')}.`);
  }
  return said.length > 0 ? said.join(' ') : undefined;
}

export function createRewind(deps: RewindDeps) {
  return {
    /** What going back before the message would move — read, nothing moved. */
    async preview(id: string, target: RewindTarget): Promise<RewindPreview> {
      const look = await deps.engine.lookBefore(id, target);
      return {
        files: await deps.checkpoints.changedSince(id, look.message.at, { except: look.earlier }),
        commands: commandsRun(look.after, deps.family(), look.branch),
        memory: await deps.engine.rewindMemory(id, target),
      };
    },

    /**
     * Going back before the person's message the window names; its text checked, nothing moved otherwise.
     * `messageId`: the window's id of that message — the document of the new branch is the window's cut there.
     */
    async rewind(id: string, target: RewindTarget, what: RewindWhat, options: { messageId?: string } = {}): Promise<RewindResult> {
      const look: RewindLook = await deps.engine.lookBefore(id, target);
      const memory = what === 'code' ? null : await deps.engine.rewindMemory(id, target);
      const commands = commandsRun(look.after, deps.family(), look.branch);
      const asTurn = `rewind-${randomUUID().slice(0, 8)}`;
      const since = look.message.at;
      const files =
        what === 'conversation'
          ? { restored: [], conflicts: [] }
          : await deps.checkpoints.undoSince(id, since, asTurn, { except: look.earlier });
      const kept = what === 'conversation' ? await deps.checkpoints.changedSince(id, since, { except: look.earlier }) : [];
      const note = rewindNote(what, { message: look.message.text, restored: files.restored, conflicts: files.conflicts, kept, commands });
      let moved: { fromBranchId: string; branchId: string };
      try {
        moved = await deps.engine.rewindTo(id, target, what, note);
      } catch (error) {
        // The conversation moved meanwhile: the files go back as they were.
        if (what !== 'conversation') await deps.checkpoints.redo(id, asTurn);
        throw error;
      }
      // The window's document of the branch left, kept for when it is shown again (« Annuler le retour », « Brancher »).
      if (what !== 'code') {
        await deps.store.keepDocument(id, moved.fromBranchId);
        // The new branch's document: the window's, cut before the message — or read again from the journal.
        if (options.messageId) await deps.store.cutDocument(id, options.messageId);
        else await deps.store.takeDocument(id, moved.branchId);
      }
      await deps.store.update(id, { rewound: { what, fromBranchId: moved.fromBranchId, branchId: moved.branchId, asTurn } });
      return { ...moved, text: look.message.text, filesRestored: files.restored, conflicts: files.conflicts, commandsNotUndone: commands, memory };
    },

    /** « Annuler le retour »: until the next turn begins; null when there is nothing to undo. */
    async undo(id: string): Promise<{ branchId: string; filesRestored: string[]; conflicts: string[] } | null> {
      const meta = await deps.store.get(id);
      const rewound = meta?.rewound;
      if (!meta || !rewound) return null;
      const files = rewound.what === 'conversation' ? { restored: [], conflicts: [] } : await deps.checkpoints.redo(id, rewound.asTurn);
      await deps.engine.undoRewind(id, rewound);
      if (rewound.what !== 'code') {
        await deps.store.keepDocument(id, rewound.branchId);
        await deps.store.takeDocument(id, rewound.fromBranchId);
      }
      await deps.store.update(id, { rewound: undefined });
      return { branchId: rewound.what === 'code' ? meta.branchId : rewound.fromBranchId, filesRestored: files.restored, conflicts: files.conflicts };
    },
  };
}

export type Rewind = ReturnType<typeof createRewind>;
