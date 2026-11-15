/**
 * What the window asks of the engine: its state, the models found on the
 * machine (each with what loading it costs), and to load one. The window
 * never names a program to run: a load takes a model the core listed.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

export const familyIdSchema = z.enum(['qwen', 'gemma', 'llama', 'mistral', 'gpt-oss']);

export const engineStatusSchema = z.enum(['stopped', 'starting', 'ready', 'crashed', 'restarting']);

export const engineStateSchema = z.object({
  mode: z.enum(['managed', 'remote']),
  status: engineStatusSchema,
  model: z
    .object({
      path: z.string(),
      name: z.string(),
      family: familyIdSchema.nullable(),
      nCtx: z.number(),
    })
    .optional(),
});

export type EngineStateView = z.infer<typeof engineStateSchema>;

export const loadAnnouncementSchema = z.object({
  kind: z.literal('engine-load'),
  seconds: z.number(),
  secondsEstimated: z.boolean(),
  vramBytes: z.number(),
  gpuBytes: z.number().nullable(),
  verdict: z.enum(['fits', 'tight', 'too-big', 'unknown']),
});

export const modelChoiceSchema = z.object({
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  source: z.enum(['lmstudio', 'hf-cache', 'custom', 'manual']),
  family: familyIdSchema.nullable(),
  supported: z.boolean(),
  problem: z.enum(['unsupported-family', 'no-chat-template', 'unreadable']).optional(),
  kvBytesPerToken: z.number().nullable(),
  announcement: loadAnnouncementSchema.nullable(),
  /** The model new conversations start on (Settings, Models). */
  isDefault: z.boolean(),
  /** When it was last loaded (ISO date); null for never. */
  lastLoadedAt: z.string().nullable(),
});

export type ModelChoiceView = z.infer<typeof modelChoiceSchema>;

export const loadErrorCodeSchema = z.enum(['not-listed', 'unsupported-family', 'no-chat-template', 'failed']);

export const engineLoadResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: engineStateSchema }),
  z.object({
    ok: z.literal(false),
    // `detail`: what the engine said, for whoever opens it — the window says the code in its own words.
    error: z.object({ code: loadErrorCodeSchema, detail: z.string() }),
  }),
]);

export type EngineLoadResult = z.infer<typeof engineLoadResultSchema>;

export const engineState = defineChannel('engine.state', z.void(), engineStateSchema);

export const engineModels = defineChannel('engine.models', z.void(), z.array(modelChoiceSchema));

export const engineLoad = defineChannel(
  'engine.load',
  z.object({ path: z.string().min(1).max(4096) }),
  engineLoadResultSchema,
);

/** The llama.cpp a load runs, and whether a newer build is published. */
export const llamaCppStateSchema = z.object({
  current: z
    .object({ source: z.enum(['configured', 'managed', 'path']), build: z.string().nullable() })
    .nullable(),
  latest: z.object({ build: z.string(), bytes: z.number() }).nullable(),
  check: z.enum(['not-asked', 'done', 'failed']),
  updateAvailable: z.boolean(),
  installing: z.object({ done: z.number(), total: z.number().nullable() }).nullable(),
});

export type LlamaCppStateView = z.infer<typeof llamaCppStateSchema>;

export const llamaInstallResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: llamaCppStateSchema }),
  z.object({
    ok: z.literal(false),
    // `digest`: the file downloaded is not the one published — deleted, never run.
    error: z.object({ code: z.enum(['digest', 'failed']), detail: z.string() }),
  }),
]);

export type LlamaInstallResult = z.infer<typeof llamaInstallResultSchema>;

/** `checkLatest`: ask GitHub what is published (the setup screen does, when it opens). */
export const engineLlama = defineChannel(
  'engine.llama',
  z.object({ checkLatest: z.boolean().optional() }),
  llamaCppStateSchema,
);

/** Downloads the newest build for this machine: only on a click, its size said before. */
export const engineLlamaInstall = defineChannel('engine.llama.install', z.void(), llamaInstallResultSchema);
