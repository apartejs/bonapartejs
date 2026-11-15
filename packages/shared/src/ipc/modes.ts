/**
 * The mode of a conversation, and the preview of a call it paused on. The
 * core keeps the mode and decides every call; the window shows the mode,
 * lets the person change it, and shows what a call would change before
 * anyone agrees to it.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

export const playModeSchema = z.enum(['lecture', 'repetition', 'plume', 'impro']);

const idSchema = z.string().min(1).max(128);

/** The mode a conversation runs in; `reconfirm`: Impro set before this run of the app, to confirm again. */
export const modeViewSchema = z.object({ mode: playModeSchema, reconfirm: z.boolean() });
export type ModeView = z.infer<typeof modeViewSchema>;

export const modesGet = defineChannel('modes.get', z.object({ id: idSchema }), modeViewSchema);

export const modesSet = defineChannel('modes.set', z.object({ id: idSchema, mode: playModeSchema }), z.void());

export const toolPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diff'), path: z.string(), before: z.string().nullable(), after: z.string(), diff: z.string() }),
  z.object({
    kind: z.literal('fails'),
    reason: z.enum(['missing', 'not-found', 'ambiguous']),
    path: z.string(),
    occurrences: z.number().optional(),
  }),
]);
export type ToolPreviewView = z.infer<typeof toolPreviewSchema>;

export const toolsPreview = defineChannel(
  'tools.preview',
  z.object({ id: idSchema, call: z.object({ name: z.string().min(1).max(256), input: z.unknown() }) }),
  toolPreviewSchema.nullable(),
);
