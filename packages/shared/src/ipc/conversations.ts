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
  evicted: z.object({ at: z.string(), budgetBytes: z.number() }).optional(),
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

