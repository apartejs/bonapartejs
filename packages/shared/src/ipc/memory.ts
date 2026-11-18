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
    busy: z.boolean(),
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

/** « Moniteur de ressources » (task 12.4): a reading of the machine; a figure it does not report is null. */
export const resourceSampleSchema = z.object({
  at: z.number(),
  cpu: z.number().nullable(),
  memory: z.object({ usedBytes: z.number(), totalBytes: z.number() }),
  gpu: z.object({ dedicatedBytes: z.number().nullable(), sharedBytes: z.number().nullable(), utilization: z.number().nullable() }).nullable(),
  server: z.object({ pid: z.number(), workingSetBytes: z.number(), cpu: z.number().nullable() }).nullable(),
  app: z.object({ workingSetBytes: z.number(), cpu: z.number().nullable() }).nullable(),
});
export type ResourceSampleView = z.infer<typeof resourceSampleSchema>;
/** The last reading, while the monitor reads; null when it does not. */
export const engineResources = defineChannel('engine.resources', z.void(), resourceSampleSchema.nullable());
/** The disk nearly full, said before a conversation's memory is saved (task 12.3); null when it fits. */
export const engineDiskCheck = defineChannel(
  'engine.diskCheck',
  z.object({ id: z.string().min(1).max(128) }),
  z.object({ freeBytes: z.number(), drive: z.string(), needBytes: z.number(), release: z.array(z.string()), enough: z.boolean() }).nullable(),
);

export const engineReleaseMemory = defineChannel('engine.releaseMemory', z.object({ id: z.string().min(1).max(128) }), z.void());
export const engineUnload = defineChannel('engine.unload', z.void(), z.void());
export const engineRestart = defineChannel('engine.restart', z.void(), z.void());
