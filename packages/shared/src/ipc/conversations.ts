/**
 * The window's conversations, through the bridge: aparté's storage adapter
 * (load them all, load one, save one, delete one) and what opening one will
 * cost. The core keeps aparté's document of a conversation beside its
 * journal; the journal stays the truth of what was said.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

/** aparté's document of a conversation: carried, not interpreted — only its id is read. */
export const conversationDocumentSchema = z.looseObject({ id: z.string().min(1).max(128) });

export type ConversationDocument = z.infer<typeof conversationDocumentSchema>;

const idInput = z.object({ id: z.string().min(1).max(128) });

export const restoreAnnouncementSchema = z.object({
  kind: z.literal('restore'),
  tokens: z.number(),
  seconds: z.number(),
  insteadOfSeconds: z.number(),
  bytes: z.number(),
  savedAt: z.string(),
  estimated: z.boolean(),
});

export const rereadAnnouncementSchema = z.object({
  kind: z.literal('reread'),
  tokens: z.number(),
  seconds: z.number(),
  reason: z.enum(['evicted', 'not-saved', 'behind', 'other-model', 'cache-types', 'context-too-small', 'engine-died']),
  /** A memory let go under the disk budget: when, and which budget. */
  evicted: z.object({ at: z.string(), budgetBytes: z.number(), byPerson: z.literal(true).optional() }).optional(),
  compactSeconds: z.number().optional(),
  estimated: z.boolean(),
});

/** What opening a conversation costs: its memory restored, read again, or nothing to pay. */
export const conversationMemorySchema = z.object({
  announcement: z.discriminatedUnion('kind', [restoreAnnouncementSchema, rereadAnnouncementSchema]).nullable(),
});

export type ConversationMemoryView = z.infer<typeof conversationMemorySchema>;

export const conversationsLoadAll = defineChannel('conversations.loadAll', z.void(), z.array(conversationDocumentSchema));

export const conversationsLoadFull = defineChannel('conversations.loadFull', idInput, conversationDocumentSchema.nullable());

export const conversationsSave = defineChannel(
  'conversations.save',
  z.object({ document: conversationDocumentSchema }),
  z.void(),
);

export const conversationsDelete = defineChannel('conversations.delete', idInput, z.void());

export const conversationsMemory = defineChannel('conversations.memory', idInput, conversationMemorySchema);

/**
 * What the sidebar shows of each conversation (§12), for the ids the window lists: its project, its memory — in
 * the engine, saved on disk, to read again, or none — and whether its last turn waits for the person.
 * A conversation that is gone is left out.
 */
const prSchema = z.object({
  number: z.number(),
  state: z.enum(['open', 'merged', 'closed']),
  url: z.string(),
  ci: z.enum(['success', 'failure', 'pending']).nullable(),
});
export type PrView = z.infer<typeof prSchema>;

export const conversationStatusSchema = z.object({
  /** The project the conversation works in, once its first turn bound it; null for none. */
  projectId: z.string().nullable(),
  memory: z.enum(['engine', 'saved', 'reread']).nullable(),
  waiting: z.boolean(),
  /** On its own branch (task 6.7): its name and what it counts against its base; absent without one. */
  branch: z
    .object({ name: z.string(), base: z.string(), ahead: z.number(), added: z.number(), removed: z.number(), files: z.number() })
    .optional(),
  /** Its branch's pull request and CI (task 6.8); absent without one. */
  pr: prSchema.optional(),
});
export type ConversationStatusView = z.infer<typeof conversationStatusSchema>;

export const conversationsStatus = defineChannel(
  'conversations.status',
  z.object({ ids: z.array(z.string().min(1).max(128)).max(500) }),
  z.record(z.string(), conversationStatusSchema),
);

/** The card of a conversation, as aparté's list reads it: no message, so the sidebar never loads a document. */
export const conversationCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pinnedAt: z.number().optional(),
  archivedAt: z.number().optional(),
});
export type ConversationCard = z.infer<typeof conversationCardSchema>;

export const conversationsLoadMeta = defineChannel('conversations.loadMeta', z.void(), z.array(conversationCardSchema));
export const conversationsRename = defineChannel('conversations.rename', z.object({ id: z.string().min(1).max(128), title: z.string().max(500) }), z.void());
export const conversationsPin = defineChannel('conversations.pin', idInput, z.void());
export const conversationsUnpin = defineChannel('conversations.unpin', idInput, z.void());
export const conversationsArchive = defineChannel('conversations.archive', idInput, z.void());
export const conversationsUnarchive = defineChannel('conversations.unarchive', idInput, z.void());
export const conversationsLoadDraft = defineChannel('conversations.loadDraft', idInput, z.string().nullable());
export const conversationsSaveDraft = defineChannel(
  'conversations.saveDraft',
  z.object({ id: z.string().min(1).max(128), text: z.string().max(1024 * 1024) }),
  z.void(),
);

/** « Ouvrir le dossier »: the conversation's own folder — its worktree —, never one the window names. */
export const conversationsOpenFolder = defineChannel('conversations.openFolder', z.object({ id: z.string().min(1).max(128) }), z.void());

/** « Ouvrir une PR », on the person's word: the branch pushed, its pull request opened (none when either failed). */
export const conversationsOpenPr = defineChannel('conversations.openPr', z.object({ id: z.string().min(1).max(128) }), prSchema.nullable());

/** « Voir la PR »: its page, in the system's browser — the address the core read, never one the window names. */
export const conversationsShowPr = defineChannel('conversations.showPr', z.object({ id: z.string().min(1).max(128) }), z.void());

/** Before archiving a conversation on its branch: what is not committed there. */
export const conversationsArchiveCheck = defineChannel(
  'conversations.archiveCheck',
  z.object({ id: z.string().min(1).max(128) }),
  z.object({ uncommitted: z.number() }),
);

/** « Commiter d'abord »: everything in its worktree committed. */
export const conversationsCommitBranch = defineChannel('conversations.commitBranch', z.object({ id: z.string().min(1).max(128) }), z.boolean());

const conversationId = z.string().min(1).max(128);
/** The person's message to go back before: its rank among their messages of the branch shown, and its text (task 7.1). */
const rewindTarget = { id: conversationId, userIndex: z.number().int().min(0).max(100_000), text: z.string().max(1_000_000) };
const rewindWhat = z.enum(['both', 'conversation', 'code']);
export type RewindWhatView = z.infer<typeof rewindWhat>;

/** What going back before a message would move, said before the person decides: nothing moves. */
export const conversationsRewindPreview = defineChannel(
  'conversations.rewindPreview',
  z.object(rewindTarget),
  z.object({ files: z.array(z.string()), commands: z.array(z.string()) }),
);

/** « Revenir »: the files, the conversation, or both, back to before the message. */
export const conversationsRewind = defineChannel(
  'conversations.rewind',
  z.object({ ...rewindTarget, what: rewindWhat }),
  z.object({
    branchId: z.string(),
    fromBranchId: z.string(),
    text: z.string(),
    filesRestored: z.array(z.string()),
    conflicts: z.array(z.string()),
    commandsNotUndone: z.array(z.string()),
  }),
);

/** « Annuler le retour »: until the next turn begins; null when nothing is left to undo. */
export const conversationsUndoRewind = defineChannel(
  'conversations.undoRewind',
  z.object({ id: conversationId }),
  z.object({ branchId: z.string(), filesRestored: z.array(z.string()), conflicts: z.array(z.string()) }).nullable(),
);
