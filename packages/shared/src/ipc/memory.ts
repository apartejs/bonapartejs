/**
 * « Moteur et mémoire » (Settings — task 5.7): what the engine runs, and the
 * memory every conversation keeps on disk; a memory let go, the model
 * unloaded or restarted — each announced by the window before.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

export const memoryRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  state: z.enum(['engine', 'saved', 'released']),
  tokens: z.number(),
  bytes: z.number().nullable(),
  at: z.string(),
  otherModel: z.boolean(),
  rereadSeconds: z.number().nullable(),
});

export const memoryOverviewSchema = z.object({
  engine: z.object({
    running: z.boolean(),
    since: z.string().nullable(),
    model: z.object({ name: z.string(), path: z.string() }).nullable(),
    nCtx: z.number(),
    cacheType: z.string(),
    slots: z.number(),
  }),
  budgetBytes: z.number(),
  usedBytes: z.number(),
  rows: z.array(memoryRowSchema),
  seed: z.object({ tokens: z.number(), restoreMs: z.number().nullable(), served: z.number() }).nullable(),
});
export type MemoryOverviewView = z.infer<typeof memoryOverviewSchema>;
export type MemoryRowView = z.infer<typeof memoryRowSchema>;

export const engineMemory = defineChannel('engine.memory', z.void(), memoryOverviewSchema);
export const engineReleaseMemory = defineChannel('engine.releaseMemory', z.object({ id: z.string().min(1).max(128) }), z.void());
export const engineUnload = defineChannel('engine.unload', z.void(), z.void());
export const engineRestart = defineChannel('engine.restart', z.void(), z.void());
