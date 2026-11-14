/**
 * `createCore` is the one entry to the core. The Electron app builds a core
 * and hands requests to it; a test builds one over a temporary folder.
 *
 * The core owns the engine. Starting it loads nothing and reaches nothing.
 * It lists the models it finds on the disk, each with its family and what
 * loading it would cost; it loads one only when asked; and a turn then runs
 * on that engine, in the family of its model. A llama.cpp server that already
 * runs ("remote", named by `BONAPARTE_LLAMA_URL` or `config/global.json`) is
 * joined instead, and spoken to in the family its template says.
 */

import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { LlamaCppHttpClient } from './backend/llamacpp/http-client.js';
import type { BackendStatus } from './backend/types.js';
import { announceLoad, type EngineLoadAnnouncement } from './costs/announce.js';
import { detectServeCommandPrefix } from './backend/llamacpp/serve-command.js';
import { readGpuMemoryBytes, readLlamaDeviceMemory } from './engine/gpu-memory.js';
import { MeasureStore } from './engine/measures.js';
import { readBuildTag } from './engine/process-probe.js';
import { EngineSupervisor, type EngineConfig, type KvCacheType } from './engine/supervisor.js';
import { layerForModel, UnsupportedFamilyError, type FamilyId, type FamilyLayer } from './families/index.js';
import { readJsonFile } from './fs/json-file.js';
import { kvBytesPerToken, readGgufInfo, type GgufInfo } from './models/gguf.js';
import { defaultScanRoots, scanModels, type ModelSource, type ScanRoot } from './models/inventory.js';
import type { SpawnFn } from './process/spawn.js';
import { settingDefault } from './settings/catalog.js';

export interface CoreDeps {
  /** The folder bonaparte keeps everything in (see `bonaparteDataDir`). */
  dataDir: string;
  /** The process environment. A test passes its own, so that the machine's does not leak in. */
  env?: NodeJS.ProcessEnv;
  /** Tests only: what to launch instead of llama.cpp (`[node, fake-llama-bin.mjs]`). */
  llamaCommand?: readonly string[];
  /** The port of the managed server (default 8763). */
  port?: number;
  /** Where models are looked for (default: the known folders, or `BONAPARTE_MODEL_DIRS`). */
  modelRoots?: ScanRoot[];
  /** The card's video memory (default: read on the machine; null when unknown). */
  gpuMemory?: () => Promise<number | null>;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
  logger?: (line: string) => void;
}

export interface EngineState {
  mode: 'managed' | 'remote';
  status: BackendStatus;
  /** The model the engine serves, once it serves one. */
  model?: { path: string; name: string; family: FamilyId | null; nCtx: number };
}

export interface ModelChoice {
  path: string;
  name: string;
  sizeBytes: number;
  source: ModelSource;
  family: FamilyId | null;
  /** The built-in engine can speak to it. */
  supported: boolean;
  /** Why it cannot: the screen says it, with the way out (a service). */
  problem?: 'unsupported-family' | 'no-chat-template' | 'unreadable';
  kvBytesPerToken: number | null;
  /** What loading it costs, said before it is paid; null when its header cannot be read. */
  announcement: EngineLoadAnnouncement | null;
}

/** The engine a turn runs on, and how its model is spoken to. */
export interface Engine {
  client: LlamaCppHttpClient;
  family: FamilyLayer;
}

export interface Core {
  /** The engine a turn runs on; undefined when no model is loaded. Never loads one. */
  engine(): Promise<Engine | undefined>;
  engineState(): Promise<EngineState>;
  models(): Promise<ModelChoice[]>;
  /** Loads a model the core listed. The window says the cost before it asks. */
  loadModel(path: string): Promise<EngineState>;
  /** A turn in progress: the model is not unloaded while one is held. */
  hold(): () => void;
  stop(): Promise<void>;
}

const engineSettingsSchema = z
  .looseObject({
    nCtx: z.number().int().min(512).optional(),
    cacheType: z.enum(['f16', 'q8_0', 'q4_0']).optional(),
    gpuLayers: z.union([z.literal('all'), z.number().int().min(0)]).optional(),
  })
  .optional();

const globalConfigSchema = z.looseObject({
  backend: z
    .union([
      z.object({ mode: z.literal('remote'), url: z.url() }),
      z.object({ mode: z.literal('managed'), binPath: z.string().min(1).optional() }),
    ])
    .optional(),
  engine: engineSettingsSchema,
});

type GlobalConfig = z.infer<typeof globalConfigSchema>;

/** The binaries tried, in order, when none is configured: the server, then the unified CLI. */
const LLAMA_CANDIDATES = ['llama-server', 'llama'];

const samePath = (a: string, b: string): boolean =>
  resolve(a).replace(/\\/g, '/').toLowerCase() === resolve(b).replace(/\\/g, '/').toLowerCase();

export function createCore(deps: CoreDeps): Core {
  const env = deps.env ?? process.env;
  const configFile = join(deps.dataDir, 'config', 'global.json');
  const engineDir = join(deps.dataDir, 'engine');
  const supervisor = new EngineSupervisor({
    slotsDir: join(deps.dataDir, 'kv-slots'),
    pidFile: join(engineDir, 'managed-server.pid'),
    measures: new MeasureStore(join(engineDir, 'measures.json')),
    ...(deps.port !== undefined ? { port: deps.port } : {}),
    ...(deps.llamaCommand ? { llamaCommand: deps.llamaCommand } : {}),
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
  });

  let config: GlobalConfig | undefined;
  let gpu: Promise<number | null> | undefined;
  let orphanChecked = false;
  let loaded: { path: string; info: GgufInfo; layer: FamilyLayer } | undefined;
  let remoteFamily: FamilyLayer | undefined;

  /** The configuration, read once. An unreadable file says so — it is not taken for "nothing configured". */
  async function readConfig(): Promise<GlobalConfig> {
    if (config) return config;
    let raw: unknown = {};
    try {
      raw = await readJsonFile(configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`The configuration file ${configFile} cannot be read: ${(error as Error).message}`);
      }
    }
    const parsed = globalConfigSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`The configuration file ${configFile} is not valid: ${parsed.error.message}`);
    config = parsed.data;
    return config;
  }

  function remoteUrl(read: GlobalConfig): string | undefined {
    const fromEnv = env['BONAPARTE_LLAMA_URL'];
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    return read.backend?.mode === 'remote' ? read.backend.url.replace(/\/+$/, '') : undefined;
  }

  async function launchSettings() {
    const read = await readConfig();
    return {
      nCtx: read.engine?.nCtx ?? (settingDefault('nCtx') as number),
      cacheType: (read.engine?.cacheType ?? settingDefault('cacheType')) as KvCacheType,
      gpuLayers: (read.engine?.gpuLayers ?? settingDefault('gpuLayers')) as number | 'all',
    };
  }

  /** Which engine the configuration names: a server to join, or one to launch. Reaches nothing. */
  async function mode(): Promise<'managed' | 'remote'> {
    return remoteUrl(await readConfig()) ? 'remote' : 'managed';
  }

  /** The remote engine, configured once. Reaches nothing: joining is a turn's. */
  async function configuredRemote(): Promise<void> {
    if (supervisor.engine) return;
    await supervisor.configure({ mode: 'remote', url: remoteUrl(await readConfig())! });
  }

  /**
   * The managed engine, configured at the first load — not before: finding
   * the binary runs it (`--version`), and asking about the engine must cost
   * nothing.
   */
  async function configuredManaged(): Promise<EngineConfig> {
    if (supervisor.engine) return supervisor.engine;
    await supervisor.configure({ mode: 'managed', binPath: await llamaBinary(), ...(await launchSettings()) });
    return supervisor.engine!;
  }

  /** The llama.cpp binary: the configured one, else the first found on the PATH — looked for once. */
  let binary: Promise<string> | undefined;
  function llamaBinary(): Promise<string> {
    binary ??= (async () => {
      const read = await readConfig();
      const binPath = read.backend?.mode === 'managed' ? read.backend.binPath : env['BONAPARTE_LLAMA_BIN'];
      return binPath ?? (deps.llamaCommand ? 'llama-server' : await findLlamaBinary());
    })();
    // A binary not found now may be installed later: the next question looks again.
    binary.catch(() => (binary = undefined));
    return binary;
  }

  /** The first llama.cpp binary on the PATH that answers --version. */
  async function findLlamaBinary(): Promise<string> {
    for (const candidate of LLAMA_CANDIDATES) {
      if ((await readBuildTag(candidate, ['--version'], deps.spawn)) !== 'unknown') return candidate;
    }
    throw new Error('llama.cpp was not found: neither llama-server nor llama answers on this machine.');
  }

  function gpuBytes(): Promise<number | null> {
    gpu ??= (deps.gpuMemory ?? machineGpuBytes)().catch(() => null);
    return gpu;
  }

  /**
   * What llama.cpp says it can use first — on a unified-memory machine the
   * registry holds only the firmware's carve-out — then the registry.
   */
  async function machineGpuBytes(): Promise<number | null> {
    const spawn = deps.spawn ? { spawn: deps.spawn } : {};
    // The fake binary of the tests has no device to list.
    if (!deps.llamaCommand) {
      const command = await llamaBinary().catch(() => undefined);
      const fromEngine = command
        ? await readLlamaDeviceMemory(command, detectServeCommandPrefix(command), spawn)
        : null;
      if (fromEngine !== null) return fromEngine;
    }
    return readGpuMemoryBytes(spawn);
  }

  async function engineState(): Promise<EngineState> {
    const engine = { mode: await mode() };
    const model = supervisor.loaded;
    return {
      mode: engine.mode,
      status: supervisor.status(),
      ...(model
        ? {
            model: {
              path: model.modelPath,
              name: nameOf(model.modelPath),
              family: engine.mode === 'managed' ? (loaded?.info.family ?? null) : (remoteFamily?.id ?? null),
              nCtx: model.nCtx,
            },
          }
        : {}),
    };
  }

  async function models(): Promise<ModelChoice[]> {
    const roots = deps.modelRoots ?? defaultScanRoots(env);
    const found = await scanModels(roots);
    const settings = await launchSettings();
    const totalBytes = await gpuBytes();
    return Promise.all(
      found.map(async (model): Promise<ModelChoice> => {
        const base = { path: model.path, name: model.name, sizeBytes: model.sizeBytes, source: model.source };
        let info: GgufInfo;
        try {
          info = await readGgufInfo(model.path);
        } catch {
          return { ...base, family: null, supported: false, problem: 'unreadable', kvBytesPerToken: null, announcement: null };
        }
        let problem: ModelChoice['problem'];
        try {
          layerForModel(info);
        } catch (error) {
          problem = error instanceof UnsupportedFamilyError ? error.code : 'unsupported-family';
        }
        const loadSeconds = supervisor.loadSeconds(model.path);
        return {
          ...base,
          family: info.family,
          supported: problem === undefined,
          ...(problem ? { problem } : {}),
          kvBytesPerToken: kvBytesPerToken(info, settings.cacheType),
          announcement: announceLoad(
            { info, fileBytes: model.sizeBytes, ...(loadSeconds !== undefined ? { loadSeconds } : {}) },
            settings,
            { totalBytes },
          ),
        };
      }),
    );
  }

  return {
    async engine() {
      if ((await mode()) === 'remote') {
        await configuredRemote();
        if (supervisor.status() !== 'ready') {
          remoteFamily = undefined;
          await supervisor.connect();
        }
        const client = supervisor.client();
        if (!client) return undefined;
        remoteFamily ??= layerForModel({ chatTemplate: (await client.props()).chatTemplate });
        return { client, family: remoteFamily };
      }
      const client = supervisor.client();
      if (!client || !loaded || supervisor.loaded?.modelPath !== loaded.path) return undefined;
      return { client, family: loaded.layer };
    },

    engineState,
    models,

    async loadModel(path) {
      if ((await mode()) !== 'managed') throw new Error('The engine is a server that already runs: it loads no model.');
      const listed = (await scanModels(deps.modelRoots ?? defaultScanRoots(env))).find((model) => samePath(model.path, path));
      if (!listed) throw new ModelNotListedError(path);
      const info = await readGgufInfo(listed.path);
      // Refused before anything is launched.
      const layer = layerForModel(info);
      await configuredManaged();
      if (!orphanChecked) {
        orphanChecked = true;
        await supervisor.killOrphan();
      }
      await supervisor.ensureLoaded(listed.path);
      loaded = { path: listed.path, info, layer };
      return engineState();
    },

    hold: () => supervisor.hold(),
    stop: () => supervisor.stop(),
  };
}

/** A load names a file the core did not list: the window may only load what it was shown. */
export class ModelNotListedError extends Error {
  constructor(readonly path: string) {
    super(`This file is not among the models bonaparte found: ${path}`);
    this.name = 'ModelNotListedError';
  }
}

function nameOf(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.gguf$/i, '');
}

