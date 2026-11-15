/**
 * The « Changements » pane (task 6.4): what the conversation changed and
 * still stands — each file's text before it, and now — and « Revenir », one
 * file back to before the conversation wrote it. A file changed since its
 * last write is named, never overwritten.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const idSchema = z.string().min(1).max(128);

export const appliedChangeSchema = z.object({
  path: z.string(),
  display: z.string(),
  created: z.boolean(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  binary: z.literal(true).optional(),
});
export type AppliedChangeView = z.infer<typeof appliedChangeSchema>;

export const revertResultSchema = z.object({ restored: z.array(z.string()), conflicts: z.array(z.string()) });
export type RevertResultView = z.infer<typeof revertResultSchema>;

export const changesList = defineChannel('changes.list', z.object({ id: idSchema }), z.array(appliedChangeSchema));

export const changesRevert = defineChannel(
  'changes.revert',
  z.object({ id: idSchema, path: z.string().min(1).max(4096) }),
  revertResultSchema,
);
