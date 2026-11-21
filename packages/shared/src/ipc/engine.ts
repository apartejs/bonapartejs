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
      /** The slots it runs: two when the sub-agents work in parallel (task 8.3). */
      slots: z.number().optional(),
    })
    .optional(),
  /** Nothing runs: the model a load would bring back (« Charger et envoyer », task 7.4); absent at the first launch. */
  resume: z
    .object({ path: z.string(), name: z.string(), unloadedAt: z.string().optional(), idleMinutes: z.number().optional() })
    .optional(),
  /**
   * Who works in the engine now (task 8.2, audit C1): a conversation by its title (empty while it has none), or one
   * of its sub-agents by its name — « Occupé : … »; `others`, how many more work beside it (two slots).
   */
  working: z.object({ title: z.string(), subagent: z.string().optional(), others: z.number() }).optional(),
});

export type EngineStateView = z.infer<typeof engineStateSchema>;

export const loadAnnouncementSchema = z.object({
  kind: z.literal('engine-load'),
  seconds: z.number(),
  secondsEstimated: z.boolean(),
  vramBytes: z.number(),
  gpuBytes: z.number().nullable(),
  verdict: z.enum(['fits', 'tight', 'too-big', 'unknown']),
  /** The context it loads with: the person's, else the largest the card holds for the model (audit 2026-11-21, D2). */
  nCtx: z.number().optional(),
});

export const modelChoiceSchema = z.object({
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  source: z.enum(['bonaparte', 'lmstudio', 'hf-cache', 'custom', 'manual']),
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

// `missing-runtime`, `old-runtime`: llama.cpp stopped before its first line because the Visual C++ runtime is missing
// or too old (0xC0000135, 0xC0000139); `silent`: it stopped without a word, its exit code in `detail`.
export const loadErrorCodeSchema = z.enum([
  'not-listed',
  'unsupported-family',
  'no-chat-template',
  'too-big',
  'missing-runtime',
  'old-runtime',
  'silent',
  'failed',
]);

export const engineLoadResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: engineStateSchema }),
  z.object({
    ok: z.literal(false),
    // `detail`: what the engine said, for whoever opens it — the window says the code in its own words.
    error: z.object({
      code: loadErrorCodeSchema,
      detail: z.string(),
      // `too-big` (task 12.3): what the model needs, what the card has, the layers that would fit (null: none).
      tooBig: z.object({ neededBytes: z.number(), gpuBytes: z.number(), gpuLayers: z.number().nullable() }).optional(),
    }),
  }),
]);

export type EngineLoadResult = z.infer<typeof engineLoadResultSchema>;

export const engineState = defineChannel('engine.state', z.void(), engineStateSchema);

/** What llama-server last wrote, and its exit code when it left (task 12.3, « Voir le journal du moteur »). */
export const engineLog = defineChannel('engine.log', z.void(), z.object({ lines: z.string(), exitCode: z.number().nullable(), exited: z.boolean() }));

export const engineModels = defineChannel('engine.models', z.void(), z.array(modelChoiceSchema));

export const engineLoad = defineChannel(
  'engine.load',
  // `offload`: « Une partie sur le processeur » for a model too big for the card (task 12.3).
  z.object({ path: z.string().min(1).max(4096), offload: z.boolean().optional() }),
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

/**
 * « Choisir un fichier… » (task 12.3): the main process opens the system's dialog — the window never names an
 * executable (security rule 1) — and the core keeps the file only when it answers as llama.cpp does.
 */
export const engineLlamaPick = defineChannel(
  'engine.llama.pick',
  z.void(),
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), state: llamaCppStateSchema }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.enum(['cancelled', 'refused']), detail: z.string() }) }),
  ]),
);

/** `checkLatest`: ask GitHub what is published (the setup screen does, when it opens). */
export const engineLlama = defineChannel(
  'engine.llama',
  z.object({ checkLatest: z.boolean().optional() }),
  llamaCppStateSchema,
);

/** Downloads the newest build for this machine: only on a click, its size said before. */
export const engineLlamaInstall = defineChannel('engine.llama.install', z.void(), llamaInstallResultSchema);

/** Microsoft's own installer of the Visual C++ runtime, at its permanent address: the window never names an address. */
export const VC_RUNTIME_DOWNLOAD = 'https://aka.ms/vc14/vc_redist.x64.exe';
/** Opens Microsoft's installer in the person's browser: llama.cpp cannot start without the runtime. */
export const engineRuntimeDownload = defineChannel('engine.runtimeDownload', z.void(), z.void());

/** A model bonaparte recommends for this machine (task 9.5): its size said before it is downloaded. */
export const recommendedModelSchema = z.object({
  id: z.string(),
  family: z.enum(['gemma', 'qwen']),
  name: z.string(),
  file: z.string(),
  bytes: z.number(),
  context: z.number(),
  /** Where it is kept once downloaded; null until then. */
  path: z.string().nullable(),
  downloading: z.object({ done: z.number(), total: z.number().nullable() }).nullable(),
});

export type RecommendedModelView = z.infer<typeof recommendedModelSchema>;

/** The models recommended for this machine's memory: asks nothing of the hub. */
export const engineRecommended = defineChannel('engine.recommended', z.void(), z.array(recommendedModelSchema));

export const modelDownloadResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), model: recommendedModelSchema }),
  z.object({
    ok: z.literal(false),
    // `digest`: the file downloaded is not the one published — deleted, never loaded.
    error: z.object({ code: z.enum(['digest', 'failed']), detail: z.string() }),
  }),
]);

export type ModelDownloadResult = z.infer<typeof modelDownloadResultSchema>;

/** Downloads one of the models recommended: only on a click, its size said before. */
export const engineModelDownload = defineChannel(
  'engine.model.download',
  z.object({ id: z.string().min(1).max(128) }),
  modelDownloadResultSchema,
);

/** Changing model, said before it is paid (task 7.4; board « Coûts annoncés », 3). */
export const modelSwitchViewSchema = z.object({
  to: z.object({ path: z.string(), name: z.string() }),
  from: z.object({ path: z.string(), name: z.string() }).nullable(),
  announcement: z.object({
    kind: z.literal('model-switch'),
    reloadSeconds: z.number(),
    rereadTokens: z.number(),
    rereadSeconds: z.number(),
    vramBytes: z.number(),
    vramBytesNow: z.number(),
    estimated: z.boolean(),
  }),
});

export type ModelSwitchView = z.infer<typeof modelSwitchViewSchema>;

const conversationIdSchema = z.string().min(1).max(128);

/** What changing to a model the core listed costs, for the conversation shown (none: a new one). Loads nothing. */
export const engineSwitchCost = defineChannel(
  'engine.switchCost',
  z.object({ path: z.string().min(1).max(4096), conversationId: conversationIdSchema.optional() }),
  modelSwitchViewSchema,
);

/** `busy`: a reply runs — the model is not changed under it. */
export const engineSwitchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: engineStateSchema, conversationId: conversationIdSchema.optional() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.union([loadErrorCodeSchema, z.literal('busy')]), detail: z.string() }) }),
]);

export type EngineSwitchResult = z.infer<typeof engineSwitchResultSchema>;

/**
 * « Changer » (`as` here: the conversation goes on in the new model at its next message) or « Brancher sur ce
 * modèle » (`copy`: a new conversation does, whose id comes back).
 */
export const engineSwitch = defineChannel(
  'engine.switch',
  z.object({ path: z.string().min(1).max(4096), conversationId: conversationIdSchema.optional(), as: z.enum(['here', 'copy']).optional() }),
  engineSwitchResultSchema,
);

/** The settings llama.cpp is launched with (task 7.4): the context of each conversation, the K/V cache type. */
export const engineLaunchSettingsSchema = z.object({
  nCtx: z.number(),
  /** None chosen: the largest context the card holds for the model (audit 2026-11-21, D2). */
  nCtxAuto: z.boolean().optional(),
  cacheType: z.enum(['f16', 'q8_0', 'q4_0']),
  gpuLayers: z.union([z.literal('all'), z.number()]),
  /** The built-in engine's sub-agents (task 8.3): one after another, or in parallel in a second slot. */
  subagents: z.enum(['sequential', 'parallel']),
});

export type EngineLaunchSettingsView = z.infer<typeof engineLaunchSettingsSchema>;

/** A change of them, as the window asks it: checked again by the core against its catalogue. */
const launchChangeSchema = z
  .object({
    nCtx: z.number().int().min(512).max(1_048_576).optional(),
    cacheType: z.enum(['f16', 'q8_0', 'q4_0']).optional(),
    subagents: z.enum(['sequential', 'parallel']).optional(),
    /** « Tout sur la carte »: the layers a too-big model put on the processor come back (review 12). */
    gpuLayers: z.literal('all').optional(),
  })
  .refine(
    (change) => change.nCtx !== undefined || change.cacheType !== undefined || change.subagents !== undefined || change.gpuLayers !== undefined,
  );

/** What a setting that restarts the engine costs (board « Coûts annoncés », 6). */
export const restartAnnouncementSchema = z.object({
  kind: z.literal('restart'),
  setting: z.string(),
  reloadSeconds: z.number(),
  estimated: z.boolean(),
  memoriesLost: z.number(),
  replyRunning: z.boolean(),
  loaded: z.boolean(),
  /** Sub-agents in parallel (task 8.3): the slot more, and its video memory (null with no model loaded). */
  parallel: z
    .object({
      slots: z.number(),
      nCtx: z.number().optional(),
      /** The context each slot had, when the automatic one steps down for two (review of C2). */
      nCtxBefore: z.number().optional(),
      vramBytesEach: z.number().nullable(),
      /** What the relaunch takes more than the engine now: two caches of `nCtx` less the one of `nCtxBefore`. */
      vramBytesMore: z.number().nullable().optional(),
    })
    .optional(),
});

export type RestartAnnouncementView = z.infer<typeof restartAnnouncementSchema>;

export const engineSettingsGet = defineChannel('engine.settings', z.void(), engineLaunchSettingsSchema);

/** What changing them costs: nothing is kept by asking. */
export const engineRestartCost = defineChannel('engine.restartCost', launchChangeSchema, restartAnnouncementSchema);

/** Keeps them; `restart`: the engine relaunches with them, at once or when the reply that runs ends. */
export const engineApplySettings = defineChannel(
  'engine.applySettings',
  z.object({ changes: launchChangeSchema, restart: z.boolean() }),
  z.void(),
);
