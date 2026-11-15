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

import { statfs } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { LlamaCppHttpClient } from './backend/llamacpp/http-client.js';
import type { BackendStatus } from './backend/types.js';
import { announceLoad, type EngineLoadAnnouncement } from './costs/announce.js';
import { detectServeCommandPrefix } from './backend/llamacpp/serve-command.js';
import {
  readGpuMemoryBytes,
  readLlamaDeviceMemory,
} from './engine/gpu-memory.js';
import { MeasureStore } from './engine/measures.js';
import { installedLlama, installLlama } from './engine/llama-install.js';
import {
  buildNumber,
  latestLlamaAsset,
  type LlamaAsset,
} from './engine/llama-release.js';
import { readBuildTag } from './engine/process-probe.js';
import {
  EngineSupervisor,
  type EngineConfig,
  type KvCacheType,
} from './engine/supervisor.js';
import {
  familyLayer,
  layerForModel,
  UnsupportedFamilyError,
  type FamilyId,
  type FamilyLayer,
} from './families/index.js';
import { readJsonFile } from './fs/json-file.js';
import { kvBytesPerToken, readGgufInfo, type GgufInfo } from './models/gguf.js';
import {
  defaultScanRoots,
  scanModels,
  type ModelSource,
  type ScanRoot,
} from './models/inventory.js';
import type { SpawnFn } from './process/spawn.js';
import { settingDefault } from './settings/catalog.js';
import { SettingsStore } from './settings/store.js';
import type { MemoryRow } from './conversation/engine.js';
import type { SeedStats } from './kv/kv-store.js';
import { exportConversations } from './conversation/export.js';
import { DiskScan, diskRoots } from './models/disk-scan.js';
import type { StreamRunEvent } from '@aparte/engine';
import { runAgentTurn } from './agent/loop.js';
import { answerPause, checkResume, type ResumeCheck } from './agent/resume.js';
import {
  createTickets,
  installationSecret,
  type Tickets,
} from './agent/tickets.js';
import {
  ConversationEngine,
  type EngineView,
  type TurnEvent,
  type TurnInput,
  type TurnResult,
} from './conversation/engine.js';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { modeAfterRestart, PermissionEngine } from './permissions/engine.js';
import { displayInPerimeter, resolveInPerimeter } from './project/paths.js';
import { previewToolCall, type ToolPreview } from './tools/preview.js';
import { toolsFor } from './prompt/system-prompt.js';
import { builtinTools } from './tools/builtin/index.js';
import { appliedChanges, type AppliedChange } from './checkpoints/changes.js';
import { CheckpointStore, type ChangedFile, type UndoResult } from './checkpoints/store.js';
import { detectProject, type ProjectFacts } from './project/detect.js';
import { readProjectInstructions } from './project/instructions.js';
import { openJournal } from './journal/journal.js';
import { projectToAparte } from './journal/projection.js';
import { ConversationIndex, type SearchResult } from './conversation/index.js';
import {
  ProjectStore,
  type NewProject,
  type Project,
  type ProjectChanges,
} from './project/store.js';
import { listEntries, readText, type FileEntry, type FileText } from './files/browse.js';
import { PluginHost } from './plugins/host.js';
import { ToolRegistry } from './tools/registry.js';
import type { ToolDef } from './tools/types.js';
import { ConversationStore } from './conversation/store.js';
import { KvStore } from './kv/kv-store.js';
import { defaultBudgetBytes } from './kv/retention.js';

/** Whose perimeter a pane browses: a conversation's, else a project's, else the home folder. */
export interface FileScope {
  conversationId?: string;
  projectId?: string;
}

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
  /** Where « Chercher sur tout le disque » walks (default: the machine's drives). */
  diskRoots?: () => Promise<string[]>;
  /** The card's video memory (default: read on the machine; null when unknown). */
  gpuMemory?: () => Promise<number | null>;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
  logger?: (line: string) => void;
  /** Tests only: the home folder the tools work in when a conversation has no project. */
  home?: string;
  /** The language the answers are written in, in plain words (« French »): the interface's. */
  replyLanguage?: () => string;
  /** Where llama.cpp's releases are read (default: GitHub's API); null: never asked (tests). */
  llamaReleases?: string | null;
}

export interface EngineState {
  mode: 'managed' | 'remote';
  status: BackendStatus;
  /** The model the engine serves, once it serves one. */
  model?: { path: string; name: string; family: FamilyId | null; nCtx: number };
}

/** « Moteur et mémoire » (Settings): the engine, and the memory every conversation keeps on disk. */
export interface MemoryOverview {
  engine: {
    running: boolean;
    /** When the model became ready (ISO date); null when none runs. */
    since: string | null;
    model: { name: string; path: string } | null;
    /** A reply runs: « Décharger » and « Redémarrer » wait for it. */
    busy: boolean;
    nCtx: number;
    cacheType: string;
    slots: number;
  };
  /** The disk budget of the memories: the person's, else derived from the free space. */
  budgetBytes: number;
  usedBytes: number;
  rows: MemoryRow[];
  /** The shared prefix a new conversation starts from: its tokens, its restore time, the conversations it served. */
  seed: SeedStats | null;
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
  /** The model new conversations start on (the setting « defaultModel »). */
  isDefault: boolean;
  /** When it was last loaded (ISO date); null for never. */
  lastLoadedAt: string | null;
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
  /** The llama.cpp a load runs, and — when asked — whether a newer build is published (GitHub). */
  llamaCpp(options?: { checkLatest?: boolean }): Promise<LlamaCppState>;
  /** Downloads the newest build, verifies it, and keeps it. Only when the person asks. */
  installLlamaCpp(): Promise<LlamaCppState>;
  /** The conversations: their cards, their journals, their turns on the engine. */
  readonly conversations: ConversationEngine;
  readonly conversationStore: ConversationStore;
  /** The one registry of tools, and the one approval policy. */
  readonly tools: ToolRegistry;
  readonly permissions: PermissionEngine;
  /** The plugins: their tools join the registry, what they reach is judged by the same policy. */
  readonly plugins: PluginHost;
  /** What each turn wrote, its originals kept: « Revenir » (6.4) and the rewind (7.1) take it back. */
  readonly checkpoints: CheckpointStore;
  /** The « Fichiers » pane: a perimeter listed and read — a conversation's, a project's, or the home folder. */
  readonly files: {
    list(scope: FileScope, dir: string | null): Promise<FileEntry[]>;
    read(scope: FileScope, path: string): Promise<FileText>;
    /** What the conversation changed and still stands. */
    changed(conversationId: string): Promise<ChangedFile[]>;
  };
  /** The « Changements » pane: what the conversation changed, before and now; « Revenir » on one file. */
  readonly changes: {
    list(conversationId: string): Promise<AppliedChange[]>;
    revert(conversationId: string, path: string): Promise<UndoResult>;
  };
  /** The page's document of a conversation; rebuilt from its journal when the page's is missing; null for none. */
  conversationDocument(id: string): Promise<unknown>;
  /** « Rechercher »: the conversations where the words were said, and the files of the open conversation's project. */
  search(
    query: string,
    options?: { conversationId?: string; projectId?: string },
  ): Promise<SearchResult>;
  /** Deletes a conversation: its card, its journal, its memory — and the originals its turns kept. */
  removeConversation(id: string): Promise<void>;
  /**
   * « Exporter les conversations… »: one Markdown file per conversation, in a folder of its own
   * made inside `into`. The labels are the window's words, in its language.
   */
  exportConversations(
    into: string,
    labels: { person: string; assistant: string; untitled: string },
  ): Promise<{ folder: string; count: number }>;
  /** The app's settings as the person left them (global scope): read, written, listened to. */
  readonly settings: SettingsStore;
  /** « Chercher sur tout le disque »: the folders where it finds models join « modelFolders ». */
  readonly diskScan: DiskScan;
  /** « Ajouter un dossier »: a folder joins the ones searched for models. */
  addModelFolder(folder: string): Promise<string[]>;
  /** « Moteur et mémoire »: what runs, and what each conversation keeps on disk. */
  memory(): Promise<MemoryOverview>;
  /** « Libérer »: a saved memory let go; reopening its conversation will say what reading it again costs. */
  releaseMemory(id: string): Promise<void>;
  /** « Décharger »: the video memory freed; the memories on disk kept (the one in the engine saved first). */
  unloadModel(): Promise<void>;
  /** « Redémarrer »: the same model loaded again — announced by the window before. */
  restartEngine(): Promise<void>;
  /** The projects: made from a folder (what it says read first), each with its folders and its default mode. */
  readonly projects: {
    detect(folder: string): Promise<ProjectFacts>;
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | undefined>;
    create(input: NewProject): Promise<Project>;
    update(id: string, changes: ProjectChanges): Promise<Project>;
    remove(id: string): Promise<void>;
  };
  /**
   * A turn of the agent: the model's calls decided by the policy, run by the
   * registry, the window's own tools (its `clientTools`) paused for it.
   */
  agentTurn(
    conversationId: string,
    input: Omit<TurnInput, 'tools'>,
    options: { clientTools: readonly ClientTool[]; signal: AbortSignal },
    emit: (event: StreamRunEvent) => void,
    onTurnEvent: (event: TurnEvent) => void,
  ): Promise<TurnResult>;
  /**
   * The mode a conversation runs in. Impro set before this run of the app is
   * not kept without a new confirmation (security rule 9): Plume until the
   * person confirms it, and `reconfirm` says so.
   */
  modeOf(
    conversationId: string,
  ): Promise<{ mode: PlayMode; reconfirm: boolean }>;
  /** `confirmed`: the person chose it in this run (the default); Impro read from a default is not. */
  setMode(conversationId: string, mode: PlayMode, options?: { confirmed?: boolean }): Promise<void>;
  /** What a call would change — the text before and after, and their diff — for the approval card. */
  previewCall(
    conversationId: string,
    call: { name: string; input: unknown },
  ): Promise<ToolPreview | null>;
  /** Is this the resume of the pause the conversation waits on: its ticket, its answers? */
  checkResume(
    conversationId: string,
    resume: {
      messageId: string;
      ticket: string;
      outcomes: Record<string, unknown>;
    },
  ): Promise<ResumeCheck>;
  /** A pause answered: its calls run or refused as answered, then the turn goes on — or pauses again. */
  resumeTurn(
    conversationId: string,
    check: Extract<ResumeCheck, { ok: true }>,
    options: {
      messageId: string;
      clientTools: readonly ClientTool[];
      signal: AbortSignal;
    },
    emit: (event: StreamRunEvent) => void,
    onTurnEvent: (event: TurnEvent) => void,
  ): Promise<TurnResult>;
}

/** A tool the window runs, as aparté's client declares it. */
export interface ClientTool {
  name: string;
  description?: unknown;
  inputSchema?: unknown;
  [key: string]: unknown;
}

interface LlamaFound {
  source: 'configured' | 'managed' | 'path';
  path: string;
  build: string | null;
}

export interface LlamaCppState {
  /** The llama.cpp a load runs: configured by the person, installed by bonaparte, or found on the PATH. */
  current: { source: LlamaFound['source']; build: string | null } | null;
  /** The newest build published for this machine, once asked. */
  latest: { build: string; bytes: number } | null;
  check: 'not-asked' | 'done' | 'failed';
  updateAvailable: boolean;
  /** A download in progress. */
  installing: { done: number; total: number | null } | null;
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
      z.object({
        mode: z.literal('managed'),
        binPath: z.string().min(1).optional(),
      }),
    ])
    .optional(),
  engine: engineSettingsSchema,
});

type GlobalConfig = z.infer<typeof globalConfigSchema>;

/** The binaries tried, in order, when none is configured: the server, then the unified CLI. */
const LLAMA_CANDIDATES = ['llama-server', 'llama'];

const samePath = (a: string, b: string): boolean =>
  resolve(a).replace(/\\/g, '/').toLowerCase() ===
  resolve(b).replace(/\\/g, '/').toLowerCase();

export function createCore(deps: CoreDeps): Core {
  const env = deps.env ?? process.env;
  const configFile = join(deps.dataDir, 'config', 'global.json');
  const engineDir = join(deps.dataDir, 'engine');
  // The KV states live where the managed server saves its slots.
  const kvDir = join(deps.dataDir, 'kv-slots');
  const measures = new MeasureStore(join(engineDir, 'measures.json'));
  // The app's settings live in the same file, under `settings`, beside the engine's.
  const appSettings = new SettingsStore(configFile);
  async function addModelFolders(folders: readonly string[]): Promise<string[]> {
    const kept = await appSettings.get('modelFolders').catch(() => []);
    const list = Array.isArray(kept) ? kept.filter((dir): dir is string => typeof dir === 'string') : [];
    const next = [...list, ...folders.filter((dir) => !list.some((known) => samePath(known, dir)))];
    if (next.length !== list.length) await appSettings.set('modelFolders', next);
    return next;
  }
  const diskScan = new DiskScan(deps.diskRoots ?? (() => diskRoots()), async (folders) => void (await addModelFolders(folders)));
  // Where the core says what went wrong without failing: the supervisor's own default.
  const log = deps.logger ?? ((line: string) => console.log(line));
  const supervisor = new EngineSupervisor({
    slotsDir: kvDir,
    pidFile: join(engineDir, 'managed-server.pid'),
    measures,
    // Unloading after a while without work waits for the reload it implies to be
    // announced (« Charger et envoyer », plan task 7.4): until then a model unloaded
    // behind the person's back would leave every next message without an engine.
    idleUnloadMinutes: 0,
    ...(deps.port !== undefined ? { port: deps.port } : {}),
    ...(deps.llamaCommand ? { llamaCommand: deps.llamaCommand } : {}),
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    // Another model replaces this one: the memory the engine holds is saved first, while it still serves.
    beforeUnload: () => conversations.flush(),
  });

  let config: GlobalConfig | undefined;
  let gpu: Promise<number | null> | undefined;
  let orphanChecked = false;
  let loaded: { path: string; info: GgufInfo; layer: FamilyLayer; at: string } | undefined;
  let remoteFamily: FamilyLayer | undefined;

  /** The configuration, read once. An unreadable file says so — it is not taken for "nothing configured". */
  async function readConfig(): Promise<GlobalConfig> {
    if (config) return config;
    let raw: unknown = {};
    try {
      raw = await readJsonFile(configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `The configuration file ${configFile} cannot be read: ${(error as Error).message}`,
        );
      }
    }
    const parsed = globalConfigSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `The configuration file ${configFile} is not valid: ${parsed.error.message}`,
      );
    config = parsed.data;
    return config;
  }

  function remoteUrl(read: GlobalConfig): string | undefined {
    const fromEnv = env['BONAPARTE_LLAMA_URL'];
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    return read.backend?.mode === 'remote'
      ? read.backend.url.replace(/\/+$/, '')
      : undefined;
  }

  async function launchSettings() {
    const read = await readConfig();
    return {
      nCtx: read.engine?.nCtx ?? (settingDefault('nCtx') as number),
      cacheType: (read.engine?.cacheType ??
        settingDefault('cacheType')) as KvCacheType,
      gpuLayers: (read.engine?.gpuLayers ?? settingDefault('gpuLayers')) as
        number | 'all',
    };
  }

  /** Which engine the configuration names: a server to join, or one to launch. Reaches nothing. */
  async function mode(): Promise<'managed' | 'remote'> {
    return remoteUrl(await readConfig()) ? 'remote' : 'managed';
  }

  /** The remote engine, configured once. Reaches nothing: joining is a turn's. */
  async function configuredRemote(): Promise<void> {
    if (supervisor.engine) return;
    await supervisor.configure({
      mode: 'remote',
      url: remoteUrl(await readConfig())!,
    });
  }

  /**
   * The managed engine, configured at the first load — not before: finding
   * the binary runs it (`--version`), and asking about the engine must cost
   * nothing.
   */
  async function configuredManaged(): Promise<EngineConfig> {
    const binPath = await llamaBinary();
    const current = supervisor.engine;
    // A build installed since: taken at the next load, never under a model that runs.
    if (
      current?.mode === 'managed' &&
      (current.binPath === binPath || supervisor.loaded)
    )
      return current;
    await supervisor.configure({
      mode: 'managed',
      binPath,
      ...(await launchSettings()),
    });
    return supervisor.engine!;
  }

  /**
   * The llama.cpp a load runs: the one the person configured, else the build
   * bonaparte installed, else the first on the PATH that answers `--version`.
   * Found once; not finding it is not remembered — it may be installed later.
   */
  let found: Promise<LlamaFound | null> | undefined;
  function llamaFound(): Promise<LlamaFound | null> {
    found ??= (async (): Promise<LlamaFound | null> => {
      const read = await readConfig();
      const configured =
        read.backend?.mode === 'managed'
          ? read.backend.binPath
          : env['BONAPARTE_LLAMA_BIN'];
      if (configured)
        return {
          source: 'configured',
          path: configured,
          build: await buildOf([configured]),
        };
      const managed = await installedLlama(llamaDir);
      if (managed)
        return {
          source: 'managed',
          path: managed.binary,
          build: managed.build,
        };
      // The tests' fake binary stands for the one on the PATH.
      if (deps.llamaCommand) {
        const build = await buildOf(deps.llamaCommand);
        return build ? { source: 'path', path: 'llama-server', build } : null;
      }
      for (const candidate of LLAMA_CANDIDATES) {
        const build = await buildOf([candidate]);
        if (build) return { source: 'path', path: candidate, build };
      }
      return null;
    })();
    void found.then(
      (result) => {
        if (!result) found = undefined;
      },
      () => (found = undefined),
    );
    return found;
  }

  /** `b12383`, read from `--version` (the unified CLI takes it without `serve`); null when it does not answer. */
  async function buildOf(command: readonly string[]): Promise<string | null> {
    const tag = await readBuildTag(
      command[0]!,
      [...command.slice(1), '--version'],
      deps.spawn,
    );
    if (tag === 'unknown') return null;
    const number = buildNumber(tag);
    return number === null ? tag : `b${number}`;
  }

  async function llamaBinary(): Promise<string> {
    const llama = await llamaFound();
    if (llama) return llama.path;
    if (deps.llamaCommand) return 'llama-server';
    throw new Error(
      'llama.cpp was not found: neither llama-server nor llama answers on this machine.',
    );
  }

  // ── Keeping llama.cpp: what is published, and downloading it on demand ──

  const llamaDir = join(deps.dataDir, 'llama.cpp');
  let latest: { at: number; asset: LlamaAsset | null } | 'failed' | undefined;
  let installing: { done: number; total: number | null } | null = null;
  let install: Promise<LlamaCppState> | undefined;
  const CHECK_EVERY_MS = 60 * 60 * 1000;

  async function checkLatest(): Promise<void> {
    if (deps.llamaReleases === null) return;
    if (
      latest &&
      latest !== 'failed' &&
      Date.now() - latest.at < CHECK_EVERY_MS
    )
      return;
    try {
      latest = {
        at: Date.now(),
        asset: await latestLlamaAsset(
          deps.llamaReleases ? { releases: deps.llamaReleases } : {},
        ),
      };
    } catch {
      latest = 'failed';
    }
  }

  async function llamaCpp(
    options: { checkLatest?: boolean } = {},
  ): Promise<LlamaCppState> {
    if (options.checkLatest) await checkLatest();
    const current = await llamaFound();
    const asset = latest && latest !== 'failed' ? latest.asset : null;
    const behind = (build: string | null): boolean => {
      const have = build === null ? null : buildNumber(build);
      const offered = asset ? buildNumber(asset.build) : null;
      return offered !== null && (have === null || have < offered);
    };
    return {
      current: current
        ? { source: current.source, build: current.build }
        : null,
      latest: asset ? { build: asset.build, bytes: asset.bytes } : null,
      check:
        latest === undefined
          ? 'not-asked'
          : latest === 'failed'
            ? 'failed'
            : 'done',
      // A llama.cpp the person configured is theirs: nothing is offered over it.
      updateAvailable:
        asset !== null &&
        current?.source !== 'configured' &&
        behind(current?.build ?? null),
      installing,
    };
  }

  function installLlamaCpp(): Promise<LlamaCppState> {
    install ??= (async () => {
      // The build a server runs is not replaced under it: a relaunch would find it gone.
      if (supervisor.loaded || supervisor.status() !== 'stopped') {
        throw new Error(
          'A model is loaded, or loading: llama.cpp is updated once it is stopped.',
        );
      }
      if (!latest || latest === 'failed' || !latest.asset) await checkLatest();
      const asset = latest && latest !== 'failed' ? latest.asset : null;
      if (!asset)
        throw new Error(
          'No llama.cpp build is published for this machine, or GitHub could not be reached.',
        );
      installing = { done: 0, total: asset.bytes };
      try {
        await installLlama({
          dir: llamaDir,
          asset,
          ...(deps.spawn ? { spawn: deps.spawn } : {}),
          onProgress: (progress) => (installing = progress),
        });
      } finally {
        installing = null;
      }
      // The new build is the one now: what it can use is asked again.
      found = undefined;
      gpu = undefined;
      return llamaCpp();
    })().finally(() => (install = undefined));
    return install;
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
      const command = (await llamaFound().catch(() => null))?.path;
      const fromEngine = command
        ? await readLlamaDeviceMemory(
            command,
            detectServeCommandPrefix(command),
            spawn,
          )
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
              family:
                engine.mode === 'managed'
                  ? (loaded?.info.family ?? null)
                  : (remoteFamily?.id ?? null),
              nCtx: model.nCtx,
            },
          }
        : {}),
    };
  }

  /** Where models are looked for: the known folders, and the ones the person added (Settings, Models). */
  async function modelRoots(): Promise<ScanRoot[]> {
    const added = await appSettings.get('modelFolders').catch(() => []);
    const folders = Array.isArray(added) ? added.filter((dir): dir is string => typeof dir === 'string') : [];
    return [...(deps.modelRoots ?? defaultScanRoots(env)), ...folders.map((dir) => ({ dir, source: 'custom' as const }))];
  }

  async function models(): Promise<ModelChoice[]> {
    const found = await scanModels(await modelRoots());
    const preferred = await appSettings.get('defaultModel').catch(() => '');
    const settings = await launchSettings();
    const totalBytes = await gpuBytes();
    return Promise.all(
      found.map(async (model): Promise<ModelChoice> => {
        const base = {
          path: model.path,
          name: model.name,
          sizeBytes: model.sizeBytes,
          source: model.source,
          isDefault: preferred === model.path,
          lastLoadedAt: measures.get(model.path)?.lastLoadedAt ?? null,
        };
        let info: GgufInfo;
        try {
          info = await readGgufInfo(model.path);
        } catch {
          return {
            ...base,
            family: null,
            supported: false,
            problem: 'unreadable',
            kvBytesPerToken: null,
            announcement: null,
          };
        }
        let problem: ModelChoice['problem'];
        try {
          layerForModel(info);
        } catch (error) {
          problem =
            error instanceof UnsupportedFamilyError
              ? error.code
              : 'unsupported-family';
        }
        const loadSeconds = supervisor.loadSeconds(model.path);
        return {
          ...base,
          family: info.family,
          supported: problem === undefined,
          ...(problem ? { problem } : {}),
          kvBytesPerToken: kvBytesPerToken(info, settings.cacheType),
          announcement: announceLoad(
            {
              info,
              fileBytes: model.sizeBytes,
              ...(loadSeconds !== undefined ? { loadSeconds } : {}),
            },
            settings,
            { totalBytes },
          ),
        };
      }),
    );
  }

  // ── The conversations ──
  // The disk budget of the KV states: 20 GiB, never more than a quarter of the free space (read once).
  let kvBudget = defaultBudgetBytes(Number.MAX_SAFE_INTEGER);
  void statfs(deps.dataDir)
    .then((disk) => (kvBudget = defaultBudgetBytes(disk.bavail * disk.bsize)))
    .catch(() => undefined);
  // The person's budget (Settings, Engine and memory), once read and as it changes.
  let kvBudgetChosen: number | null = null;
  void appSettings
    .get('kvBudgetBytes')
    .then((value) => (kvBudgetChosen = typeof value === 'number' ? value : null))
    .catch(() => undefined);
  appSettings.onChange((key, value) => {
    if (key === 'kvBudgetBytes') kvBudgetChosen = typeof value === 'number' ? value : null;
  });
  const kv = new KvStore(resolve(kvDir), { budgetBytes: () => kvBudgetChosen ?? kvBudget });
  const conversationStore = new ConversationStore(
    join(deps.dataDir, 'conversations'),
  );
  // The one registry, and the one policy. No project yet: the perimeter is the home folder.
  const tools = new ToolRegistry();
  for (const tool of builtinTools()) tools.register(tool.def, tool.handler);
  // Without a project the perimeter is the home folder — a test run's own, when it gives one.
  const perimeter = (): string[] => (deps.home ? [deps.home] : []);
  // The projects (task 5.3): a conversation of a project works in its folders. Their roots are read
  // before a turn, a preview or a resume (rootsOf), so the policy — which decides at once — finds them.
  const projectStore = new ProjectStore(deps.dataDir);
  const projectRoots = new Map<string, string[]>();
  // What each project adds to « toujours demandé », kept as projects are read and changed.
  const projectAlwaysAsk = new Map<string, string[]>();
  void projectStore
    .list()
    .then((projects) => {
      for (const project of projects) projectAlwaysAsk.set(project.id, project.alwaysAsk ?? []);
    })
    .catch(() => undefined);
  // « Permissions », as the person leaves them: the network asked, the files always asked.
  let askBeforeNetwork = true;
  let alwaysAsk: string[] = [];
  const readPolicy = (key: string, value: unknown): void => {
    if (key === 'askBeforeNetwork') askBeforeNetwork = value !== false;
    if (key === 'alwaysAsk') alwaysAsk = Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
  };
  void Promise.all(['askBeforeNetwork', 'alwaysAsk'].map(async (key) => readPolicy(key, await appSettings.get(key)))).catch(() => undefined);
  appSettings.onChange(readPolicy);
  async function rootsOf(
    conversationId: string,
  ): Promise<{ roots: string[]; projectId?: string }> {
    const projectId = (await conversationStore.get(conversationId))?.projectId;
    const project = projectId ? await projectStore.get(projectId) : undefined;
    if (!project) return { roots: perimeter() };
    projectRoots.set(project.id, project.roots);
    return { roots: project.roots, projectId: project.id };
  }
  const permissions = new PermissionEngine({
    roots: (projectId) =>
      projectId ? (projectRoots.get(projectId) ?? perimeter()) : perimeter(),
    dataDir: deps.dataDir,
    askBeforeNetwork: () => askBeforeNetwork,
    alwaysAsk: (projectId) => [...alwaysAsk, ...(projectId ? (projectAlwaysAsk.get(projectId) ?? []) : [])],
  });
  // Before a tool writes, the file as it was, kept per turn (the turn is its message).
  const checkpoints = new CheckpointStore(join(deps.dataDir, 'checkpoints'));
  // « Rechercher »: the conversations' text, read once, refreshed when a turn ends (task 5.8).
  const index = new ConversationIndex(
    conversationStore,
    () => loaded?.layer ?? remoteFamily ?? familyLayer('gemma'),
  );
  const keepOriginals = (conversationId: string, turnId: string) => ({
    beforeWrite: (absolute: string, shown: string) =>
      checkpoints.before(conversationId, turnId, absolute, shown),
    afterWrite: (absolute: string) =>
      checkpoints.after(conversationId, turnId, absolute),
  });
  // Impro confirmed by the person during this run of the app: a mode read from disk is not a confirmation.
  const improConfirmed = new Set<string>();
  async function modeOf(
    conversationId: string,
  ): Promise<{ mode: PlayMode; reconfirm: boolean }> {
    const mode =
      (await conversationStore.get(conversationId))?.mode ?? 'repetition';
    if (mode === 'impro' && !improConfirmed.has(conversationId))
      return { mode: modeAfterRestart(mode), reconfirm: true };
    return { mode, reconfirm: false };
  }
  // The perimeter a pane browses: a conversation's, else a project's, else the home folder.
  async function scopeRoots(scope: FileScope): Promise<string[]> {
    if (scope.conversationId && (await conversationStore.get(scope.conversationId))) return (await rootsOf(scope.conversationId)).roots;
    const project = scope.projectId ? await projectStore.get(scope.projectId) : undefined;
    return project ? project.roots : perimeter();
  }
  // The plugins (task 6.1): their tools join the one registry; each core tool one of them uses is
  // judged by the one policy, in its conversation's mode and perimeter. A project may turn one off.
  const plugins = new PluginHost({
    registry: tools,
    log,
    judge: async ({ conversationId, tool, input }) => {
      const { projectId } = await rootsOf(conversationId);
      const { mode } = await modeOf(conversationId);
      return permissions.evaluate({ tool, input, mode, ...(projectId ? { projectId } : {}) });
    },
  });
  // The tickets of paused turns, signed with this installation's secret (made at the first turn).
  let ticketsReady: Promise<Tickets> | undefined;
  const tickets = (): Promise<Tickets> =>
    (ticketsReady ??= installationSecret(deps.dataDir).then((secret) =>
      createTickets(secret),
    ));
  const conversations = new ConversationEngine({
    store: conversationStore,
    kv,
    measures,
    // The model is told the mode the calls are decided in: Impro not confirmed again runs, and is told, as Plume.
    mode: async (meta) => (await modeOf(meta.id)).mode,
    engine: async (): Promise<EngineView | undefined> => {
      const engine = await currentEngine();
      if (!engine) return undefined;
      const live = (await mode()) === 'managed' ? supervisor.live : null;
      return {
        ...engine,
        live,
        modelPath: supervisor.loaded?.modelPath ?? '',
        kvBytesPerToken:
          loaded && live ? kvBytesPerToken(loaded.info, live.cacheTypeK) : null,
        generation: supervisor.generation,
      };
    },
    prompt: (meta) => ({
      kind: meta.kind,
      tools: toolsFor(meta.kind, tools.view(plugins.visibleTo(meta.projectId)).list()),
      perimeter: meta.projectId ? (projectRoots.get(meta.projectId) ?? []) : [],
      replyLanguage: deps.replyLanguage?.() ?? 'English',
    }),
    // The project's instructions (.bonaparte/instructions.md, AGENTS.md or CLAUDE.md), read at each turn:
    // frozen at the first, a change told by a note (task 4.7).
    instructions: async (meta) => {
      const project = meta.projectId
        ? await projectStore.get(meta.projectId)
        : undefined;
      return project
        ? ((await readProjectInstructions(project.roots))?.text ?? '')
        : undefined;
    },
    // The person learns it when the conversation opens again (« not saved »); the log keeps why.
    onSaveError: (error, conversationId) =>
      log(
        `[bonaparte] the memory of ${conversationId} was not saved: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

  async function currentEngine(): Promise<Engine | undefined> {
    if ((await mode()) === 'remote') {
      await configuredRemote();
      if (supervisor.status() !== 'ready') {
        remoteFamily = undefined;
        await supervisor.connect();
      }
      const client = supervisor.client();
      if (!client) return undefined;
      remoteFamily ??= layerForModel({
        chatTemplate: (await client.props()).chatTemplate,
      });
      return { client, family: remoteFamily };
    }
    const client = supervisor.client();
    if (!client || !loaded || supervisor.loaded?.modelPath !== loaded.path)
      return undefined;
    return { client, family: loaded.layer };
  }

  async function agentTurn(
    conversationId: string,
    input: Omit<TurnInput, 'tools'>,
    options: { clientTools: readonly ClientTool[]; signal: AbortSignal },
    emit: (event: StreamRunEvent) => void,
    onTurnEvent: (event: TurnEvent) => void,
  ): Promise<TurnResult> {
    const windowTools: ToolDef[] = options.clientTools.map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      inputSchema:
        typeof tool.inputSchema === 'object' && tool.inputSchema !== null
          ? (tool.inputSchema as Record<string, unknown>)
          : {},
      effect: 'ui',
      source: 'builtin',
      where: 'window',
    }));
    const signer = await tickets();
    const { roots, projectId } = await rootsOf(conversationId);
    // Whatever becomes of the turn, what it wrote is found by « Rechercher » at once.
    try {
      return await runAgentTurn(
        {
          conversationId,
          input,
          mode: (await modeOf(conversationId)).mode,
          ...(projectId ? { projectId } : {}),
          registry: tools.view(plugins.visibleTo(projectId)),
          permissions,
          conversations,
          roots,
          nCtx: supervisor.loaded?.nCtx ?? (settingDefault('nCtx') as number),
          windowTools,
          ...keepOriginals(conversationId, input.messageId ?? 'turn'),
          ticket: (pending) =>
            signer.signTicket({
              messageId: input.messageId ?? '',
              calls: pending.map((call) => call.toolCallId),
            }),
          signal: options.signal,
        },
        emit,
        onTurnEvent,
      );
    } finally {
      await index.refresh(conversationId).catch(() => undefined);
    }
  }

  return {
    engine: currentEngine,
    engineState,
    models,

    async loadModel(path) {
      if ((await mode()) !== 'managed')
        throw new Error(
          'The engine is a server that already runs: it loads no model.',
        );
      const listed = (
        await scanModels(await modelRoots())
      ).find((model) => samePath(model.path, path));
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
      loaded = { path: listed.path, info, layer, at: new Date().toISOString() };
      return engineState();
    },

    hold: () => supervisor.hold(),
    // The conversation in the slot is saved before the engine stops: its memory survives the restart.
    async stop() {
      await conversations
        .flush()
        .catch((error: unknown) =>
          log(`[bonaparte] a memory was not saved: ${String(error)}`),
        );
      await plugins.deactivateAll();
      await supervisor.stop();
    },
    conversations,
    conversationStore,
    tools,
    permissions,
    plugins,
    checkpoints,

    files: {
      list: async (scope, dir) => listEntries(await scopeRoots(scope), dir, deps.home),
      read: async (scope, path) => readText(await scopeRoots(scope), path, undefined, deps.home),
      changed: (conversationId) => checkpoints.files(conversationId),
    },

    changes: {
      list: (conversationId) => appliedChanges(checkpoints, conversationId),
      revert: (conversationId, path) => checkpoints.revertFile(conversationId, path),
    },

    projects: {
      detect: (folder) => detectProject(folder),
      list: () => projectStore.list(),
      get: (id) => projectStore.get(id),
      create: (input) => projectStore.create(input),
      async update(id, changes) {
        const project = await projectStore.update(id, changes);
        projectRoots.set(project.id, project.roots);
        projectAlwaysAsk.set(project.id, project.alwaysAsk ?? []);
        return project;
      },
      remove: (id) => projectStore.remove(id),
    },

    async search(query, options = {}) {
      // The files of the open conversation's project, or of the project a new one starts in;
      // none without a project (never the whole home folder).
      if (options.projectId && !options.conversationId) {
        const project = await projectStore.get(options.projectId);
        return index.search(query, project ? { roots: project.roots } : {});
      }
      const place = options.conversationId
        ? await rootsOf(options.conversationId)
        : undefined;
      return index.search(
        query,
        place?.projectId ? { roots: place.roots } : {},
      );
    },

    async conversationDocument(id) {
      const saved = await conversationStore.loadDocument(id);
      if (saved !== null) return saved;
      const meta = await conversationStore.get(id);
      if (!meta) return null;
      // The journal is the truth: read with the family of the engine loaded, Gemma's (the product's) without one.
      const family =
        (await currentEngine().catch(() => undefined))?.family ??
        familyLayer('gemma');
      const journal = await openJournal(
        conversationStore.dir,
        id,
        meta.branchId,
      );
      return projectToAparte(meta, journal.entries(), family);
    },

    async removeConversation(id) {
      await conversations.remove(id);
      // Copies of the person's files never outlive the conversation that kept them.
      await checkpoints.forget(id);
    },

    exportConversations(into, labels) {
      const day = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      return exportConversations({
        store: conversationStore,
        family: () => loaded?.layer ?? remoteFamily ?? familyLayer('gemma'),
        into,
        labels,
        date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
      });
    },
    settings: appSettings,
    diskScan,
    addModelFolder: (folder) => addModelFolders([folder]),

    async memory() {
      const state = await engineState();
      const running = state.status === 'ready' && loaded !== undefined;
      const launch = await launchSettings();
      const chosen = await appSettings.get('kvBudgetBytes').catch(() => null);
      const usage = await kv.usage();
      const newestSeed = usage.entries.filter((entry) => entry.kind === 'seed').sort((a, b) => b.usedAt - a.usedAt)[0];
      return {
        engine: {
          running,
          since: running ? loaded!.at : null,
          model: running ? { name: basename(loaded!.path).replace(/\.gguf$/i, ''), path: loaded!.path } : null,
          busy: supervisor.held,
          nCtx: launch.nCtx,
          cacheType: launch.cacheType,
          slots: 1,
        },
        budgetBytes: typeof chosen === 'number' ? chosen : kvBudget,
        usedBytes: usage.totalBytes,
        rows: await conversations.memory(),
        seed: newestSeed ? await kv.seedStats(newestSeed.id) : null,
      };
    },

    releaseMemory: (id) => conversations.release(id),

    async unloadModel() {
      // A reply in progress keeps the engine: cutting it would lose its answer and its memory.
      if (supervisor.held) throw new Error('A reply is running: the engine is not unloaded under it.');
      await conversations
        .flush()
        .catch((error: unknown) => log(`[bonaparte] a memory was not saved: ${String(error)}`));
      await supervisor.stop();
      loaded = undefined;
    },

    async restartEngine() {
      if (!loaded) throw new Error('No model runs: there is nothing to restart.');
      if (supervisor.held) throw new Error('A reply is running: the engine is not restarted under it.');
      const path = loaded.path;
      await this.unloadModel();
      await this.loadModel(path);
    },

    agentTurn,
    modeOf,

    async setMode(conversationId, mode, options = {}) {
      await conversationStore.update(conversationId, { mode });
      if (mode === 'impro' && options.confirmed !== false) improConfirmed.add(conversationId);
      else improConfirmed.delete(conversationId);
    },

    async previewCall(conversationId, call) {
      const { roots } = await rootsOf(conversationId);
      const preview = await previewToolCall(call, {
        resolve: (requested) => {
          try {
            return resolveInPerimeter(roots, requested);
          } catch {
            return null;
          }
        },
        display: (absolute) => displayInPerimeter(roots, absolute),
      });
      return preview ?? null;
    },

    async checkResume(conversationId, resume) {
      return checkResume(
        await conversations.paused(conversationId),
        resume,
        await tickets(),
      );
    },

    async resumeTurn(conversationId, check, options, emit, onTurnEvent) {
      const place = await rootsOf(conversationId);
      const { results, waiting } = await answerPause(
        {
          conversationId,
          mode: (await modeOf(conversationId)).mode,
          ...(place.projectId ? { projectId: place.projectId } : {}),
          registry: tools.view(plugins.visibleTo(place.projectId)),
          permissions,
          roots: place.roots,
          nCtx: supervisor.loaded?.nCtx ?? (settingDefault('nCtx') as number),
          signal: options.signal,
          windowTools: new Set(options.clientTools.map((tool) => tool.name)),
          ...keepOriginals(conversationId, options.messageId),
        },
        check.pause,
        check.outcomes,
        emit,
      );
      if (waiting.length > 0) {
        // A call queued behind must be asked about in its turn: the turn pauses again.
        const ticket = (await tickets()).signTicket({
          messageId: options.messageId,
          calls: waiting.map((call) => call.toolCallId),
        });
        await conversations.recordAnswers(conversationId, {
          outcomes: check.outcomes,
          results,
          pending: { calls: waiting, ticket },
        });
        return {
          usage: { inputTokens: 0, outputTokens: 0 },
          suspended: { pending: waiting, ticket },
        };
      }
      await conversations.recordAnswers(conversationId, {
        outcomes: check.outcomes,
        results,
      });
      return agentTurn(
        conversationId,
        { resume: true, messageId: options.messageId },
        options,
        emit,
        onTurnEvent,
      );
    },
    llamaCpp,
    installLlamaCpp,
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
