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
  reason: z.enum(['evicted', 'not-saved', 'behind', 'other-model', 'cache-types', 'context-too-small', 'engine-died', 'rewind']),
  /** A memory let go under the disk budget: when, and which budget. */
  evicted: z.object({ at: z.string(), budgetBytes: z.number(), byPerson: z.literal(true).optional() }).optional(),
  compactSeconds: z.number().optional(),
  /** `other-model`: the model its memory was made with — « Repasser à … » (task 12.3). */
  savedWith: z.string().optional(),
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
  /** A reply finished since the window last showed it (task 8.4): « Pas encore lu ». */
  unread: z.boolean().optional(),
  /** On a service, not the built-in engine (task 9.3): which, and its model. */
  service: z.object({ id: z.string(), label: z.string(), model: z.string() }).optional(),
  /** A discussion, or a code conversation (task 9.7). */
  kind: z.enum(['code', 'discussion']).optional(),
});
export type ConversationStatusView = z.infer<typeof conversationStatusSchema>;

export const conversationsStatus = defineChannel(
  'conversations.status',
  z.object({ ids: z.array(z.string().min(1).max(128)).max(500) }),
  z.record(z.string(), conversationStatusSchema),
);

/* « À traiter » (task 8.4): what waits for the person, across the conversations. */
const inboxItem = { conversationId: z.string(), title: z.string(), at: z.string() };
const inboxCall = z.object({ id: z.string(), name: z.string(), input: z.unknown() });
export const inboxSchema = z.object({
  approvals: z.array(z.object({ ...inboxItem, call: inboxCall })),
  subagentRequests: z.array(z.object({ ...inboxItem, call: inboxCall, agent: z.string() })),
  questions: z.array(z.object({ ...inboxItem, call: inboxCall, question: z.string() })),
  ciFailures: z.array(z.object({ ...inboxItem, pr: z.object({ number: z.number(), url: z.string() }) })),
  costs: z.array(z.object({ ...inboxItem, tokens: z.number(), seconds: z.number() })),
  unread: z.array(z.object({ ...inboxItem, said: z.string() })),
});
export type InboxView = z.infer<typeof inboxSchema>;

export const conversationsInbox = defineChannel('conversations.inbox', z.void(), inboxSchema);

/** The window shows a conversation: what it finished so far is read. */
export const conversationsSeen = defineChannel('conversations.seen', z.object({ id: z.string().min(1).max(128) }), z.void());

/** « Relire et continuer »: the conversation read again now, nothing generated. */
export const conversationsReadAgain = defineChannel('conversations.readAgain', z.object({ id: z.string().min(1).max(128) }), z.void());

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
  z.object({ files: z.array(z.string()), commands: z.array(z.string()), memory: z.union([z.literal('kept'), rereadAnnouncementSchema]).nullable() }),
);

/** « Revenir »: the files, the conversation, or both, back to before the message. */
export const conversationsRewind = defineChannel(
  'conversations.rewind',
  // `messageId`: the window's id of the message — its document of the new branch is cut there.
  z.object({ ...rewindTarget, what: rewindWhat, messageId: z.string().max(256).optional() }),
  z.object({
    branchId: z.string(),
    fromBranchId: z.string(),
    text: z.string(),
    filesRestored: z.array(z.string()),
    conflicts: z.array(z.string()),
    commandsNotUndone: z.array(z.string()),
    memory: z.union([z.literal('kept'), rereadAnnouncementSchema]).nullable(),
  }),
);

/** « Annuler le retour »: until the next turn begins; null when nothing is left to undo. */
export const conversationsUndoRewind = defineChannel(
  'conversations.undoRewind',
  z.object({ id: conversationId }),
  z.object({ branchId: z.string(), filesRestored: z.array(z.string()), conflicts: z.array(z.string()) }).nullable(),
);

const branchView = z.object({
  branchId: z.string(),
  active: z.boolean(),
  at: z.string(),
  userIndex: z.number(),
  startsWith: z.enum(['message', 'answer', 'nothing']),
  label: z.string(),
  messages: z.number(),
});
export type BranchView = z.infer<typeof branchView>;

/** « Brancher »: the branches of the conversation, where each parts and what it says there (task 7.2). */
export const conversationsBranches = defineChannel('conversations.branches', z.object({ id: conversationId }), z.array(branchView));

/** Another branch shown: the window's document of the one left kept, the other's given back (the page loads it again). */
export const conversationsSwitchBranch = defineChannel(
  'conversations.switchBranch',
  z.object({ id: conversationId, branchId: z.string().regex(/^[\w-]{1,64}$/) }),
  z.void(),
);

/** The sibling answer the person picked in the chat: the window's messages of the path shown; the branch followed, or null. */
export const conversationsFollowPath = defineChannel(
  'conversations.followPath',
  z.object({ id: conversationId, messageIds: z.array(z.string().max(256)).max(100_000) }),
  z.string().nullable(),
);

/** « Compacter » (task 7.3): the conversation summarised and rebased — or why not, nothing changed then. */
export const conversationsCompact = defineChannel(
  'conversations.compact',
  z.object({ id: conversationId }),
  z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      summary: z.string(),
      compactedTurns: z.number(),
      keptTurns: z.number(),
      tokensBefore: z.number(),
      tokensAfter: z.number(),
    }),
    z.object({ ok: z.literal(false), reason: z.enum(['pending', 'not-worth', 'no-room', 'cut', 'empty']) }),
  ]),
);

/** « Restaurer » a compaction (aparté's checkpoint): the conversation goes on from before it, on a branch. */
export const conversationsUncompact = defineChannel('conversations.uncompact', z.object({ id: conversationId }), z.string());

const contextFullSchema = z.object({ kind: z.literal('context-full'), used: z.number(), window: z.number(), compactSeconds: z.number() });
export type ContextFullView = z.infer<typeof contextFullSchema>;

/** The context nearly full — from 90 % —, with what compacting would take; null below. */
export const conversationsContext = defineChannel('conversations.context', z.object({ id: conversationId }), contextFullSchema.nullable());


/** « Travailler dans un projet… » (task 9.7): a discussion becomes a code conversation of the project. */
export const conversationsAttachProject = defineChannel(
  'conversations.attachProject',
  z.object({ id: z.string().min(1).max(128), projectId: z.string().min(1).max(128) }),
  z.void(),
);
