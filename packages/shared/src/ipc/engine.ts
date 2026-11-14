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
