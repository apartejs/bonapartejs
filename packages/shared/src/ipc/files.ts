/**
 * The « Fichiers » pane (task 6.3): the perimeter of a conversation — its
 * project's folders, or the home folder — listed as its folders open, a file
 * read for its preview, and what the conversation changed (« M »). The core
 * resolves every path inside the perimeter; the window only gives back the
 * paths it was given.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const idSchema = z.string().min(1).max(128);
const pathSchema = z.string().min(1).max(4096);

/** Whose perimeter: a conversation's, else a project's, else the home folder. */
export const fileScopeSchema = z.object({ conversationId: idSchema.optional(), projectId: idSchema.optional() }).strict();
export type FileScopeView = z.infer<typeof fileScopeSchema>;

export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  display: z.string(),
  kind: z.enum(['dir', 'file']),
});
export type FileEntryView = z.infer<typeof fileEntrySchema>;

export const fileTextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), truncated: z.boolean() }),
  z.object({ kind: z.literal('binary') }),
]);
export type FileTextView = z.infer<typeof fileTextSchema>;

export const changedFileSchema = z.object({ path: z.string(), display: z.string(), created: z.boolean() });
export type ChangedFileView = z.infer<typeof changedFileSchema>;

/** A folder's entries; null: the top of the perimeter. */
export const filesList = defineChannel(
  'files.list',
  z.object({ scope: fileScopeSchema, dir: pathSchema.nullable() }),
  z.array(fileEntrySchema),
);

export const filesRead = defineChannel('files.read', z.object({ scope: fileScopeSchema, path: pathSchema }), fileTextSchema);

/** What the conversation changed and still stands. */
export const filesChanged = defineChannel('files.changed', z.object({ id: idSchema }), z.array(changedFileSchema));
