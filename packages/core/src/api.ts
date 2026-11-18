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

import { access, mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { LlamaCppHttpClient } from './backend/llamacpp/http-client.js';
import type { BackendStatus } from './backend/types.js';
import {
  announceLoad,
  announceModelSwitch,
  announceParallelSlots,
  announceRestart,
  type Announcement,
  type EngineLoadAnnouncement,
  type ModelSwitchAnnouncement,
  type RestartAnnouncement,
} from './costs/announce.js';
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
import { createBranches, type Branches } from './conversation/branches.js';
import { CompactionError, type CompactionRefusal } from './conversation/compact.js';
import type { CompactResult } from './conversation/engine.js';
import { createRewind, type RewindPreview, type RewindResult, type RewindTarget, type RewindWhat } from './conversation/rewind.js';
import { DiskScan, diskRoots } from './models/disk-scan.js';
import { CATALOGUE, modelUrl, recommendedModels, type CatalogueEntry } from './models/catalogue.js';
import { downloadFile } from './models/download.js';
import { runDoctor, type DoctorReport } from './doctor/doctor.js';
import { createWebSearch, type EmbeddedSearch } from './search/service.js';
import { McpService } from './mcp/service.js';
import { ProjectRuns, type RunView } from './project/runs.js';
import { withoutSecrets } from './process/env.js';
import type { OnlineProvider, SearchProvider } from './search/online.js';
import { compareWithJournal } from './agent/divergence.js';
import type { AgentMessage } from './agent/body.js';
import type { Outcome, PendingCall, Usage } from './journal/types.js';
import type { StreamRunEvent } from '@aparte/engine';
import { runAgentTurn, type ChangePlace } from './agent/loop.js';
import { answerPause, checkResume, type ResumeCheck } from './agent/resume.js';
import { readInbox, saidIn, type Inbox } from './conversation/inbox.js';
import { branchModel } from './conversation/switch.js';
import { resumeSubagent, runQueuedSubagent, subagentId } from './agent/subagents.js';
import {
  createTickets,
  installationSecret,
  type Tickets,
} from './agent/tickets.js';
import {
  ContextFullError,
  ConversationEngine,
  NoEngineError,
  type EngineView,
  type TurnEvent,
  type TurnInput,
  type TurnResult,
} from './conversation/engine.js';
import type { BrowserService, PlayMode, TerminalService } from '@aparte/bonaparte-shared';
import { modeAfterRestart, PermissionEngine } from './permissions/engine.js';
import { displayInPerimeter, resolveInPerimeter } from './project/paths.js';
import { previewToolCall, type ToolPreview } from './tools/preview.js';
import { buildServicePrompt, toolsFor } from './prompt/system-prompt.js';
import { serveOnService } from './agent/endpoint.js';
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
import { branchRoots, branchStatus, commitAll, createWorktree, lockWorktree, removeWorktree, repoRoot, uncommittedFiles, unlockWorktree, type BranchStatus } from './git/worktrees.js';
import { openPr, prStatus, type PrStatus } from './git/pr.js';
import { currentBranch } from './git/branch.js';
import { PluginHost } from './plugins/host.js';
import { ToolRegistry } from './tools/registry.js';
import type { CommandOutputEvent, ToolDef } from './tools/types.js';
import { ConversationStore } from './conversation/store.js';
import { KvStore, memoriesRefusedBy } from './kv/kv-store.js';
import { defaultBudgetBytes } from './kv/retention.js';
import { probeEndpoint, type ProbeResult } from './providers/probe.js';
import { BUILTIN_PROVIDER, ProviderRegistry, type NewProvider, type Provider } from './providers/registry.js';
import type { SecretStore } from './providers/secrets.js';

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
  /** The engine changed on its own or by a load (it started, stopped, was unloaded for want of work): the window reads it again. */
  engineChanged?: () => void;
  /** GitHub's CLI, for a branch's pull request: `gh` by default; a fake one in tests; null for none (a test run never asks GitHub). */
  gh?: readonly string[] | null;
  /** Terminals for the plugins: the app finds the shells and runs them in a process of its own. None without it. */
  terminals?: TerminalService;
  /** An event of a plugin for one of its views (a terminal's tab), pushed to the window. */
  pluginEvent?: (pluginId: string, instanceId: string, event: string, payload: unknown) => void;
  /** What a command of the agent prints, as it prints it: the terminal's agent tab. */
  commandOutput?: (conversationId: string, event: CommandOutputEvent) => void;
  /** Tests only: the home folder the tools work in when a conversation has no project. */
  home?: string;
  /** The language the answers are written in, in plain words (« French »): the interface's. */
  replyLanguage?: () => string;
  /** Where llama.cpp's releases are read (default: GitHub's API); null: never asked (tests). */
  llamaReleases?: string | null;
  /** The system's vault, for the services' keys (task 9.1). Without it, a key is refused, never written. */
  secrets?: SecretStore;
  /** Where the recommended models are downloaded from (default: Hugging Face); null: never asked (tests). */
  modelHub?: string | null;
  /** Tests only: the models recommended, instead of the product's catalogue. */
  modelCatalogue?: readonly CatalogueEntry[];
  /** The hidden page of the main process that reads the public search engine (task 10.4); none: no search without a key. */
  webSearch?: EmbeddedSearch;
  /** Tests only: what an online search provider is asked with. */
  fetch?: typeof globalThis.fetch;
  /** The built-in browser of the main process (task 10.1); none: no browser tool works. */
  browser?: BrowserService;
}

/** Whose project's runs (task 10.3): a conversation's, or a project named — never a folder of the window's. */
export interface RunScope {
  conversationId?: string;
  projectId?: string;
}

/** A model bonaparte recommends for this machine (task 9.5), and where it stands on it. */
export interface RecommendedModel {
  id: string;
  family: CatalogueEntry['family'];
  name: string;
  file: string;
  /** Its size, said before it is downloaded. */
  bytes: number;
  context: number;
  /** Where it is kept once downloaded; null until then. */
  path: string | null;
  /** A download in progress. */
  downloading: { done: number; total: number | null } | null;
}

/** A provider as the window sees it: whether it has a key, never the key. */
export type ProviderView = Provider & { hasKey: boolean };

export interface EngineState {
  mode: 'managed' | 'remote';
  status: BackendStatus;
  /** The model the engine serves, once it serves one. */
  model?: { path: string; name: string; family: FamilyId | null; nCtx: number; slots?: number };
  /**
   * Nothing runs (managed engine): the model a load would bring back (task 7.4, « Charger et envoyer ») — the
   * one unloaded (when, and after how many minutes without work when it was for want of work), else the default
   * one, else the one loaded last. Absent when none is known: the first launch.
   */
  resume?: { path: string; name: string; unloadedAt?: string; idleMinutes?: number };
  /** A sub-agent works in the engine now (task 8.2): the card says « Occupé : sous-agent … ». */
  working?: { subagent: string };
}

/**
 * A turn ended (task 8.5, the notifications): it answered, it waits for the person — an approval, a question —
 * or the engine failed under it. A turn the person stopped, or refused before it ran, ends untold.
 */
export type TurnEnd = { conversationId: string; title: string } & (
  | { how: 'done'; said: string }
  | { how: 'approval'; call: { name: string; input: unknown }; agent?: string }
  | { how: 'question'; question: string }
  | { how: 'failed' }
);

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

/** The settings llama.cpp is launched with (task 7.4): the context of each conversation, the K/V cache type. */
export interface EngineLaunchSettings {
  nCtx: number;
  cacheType: 'f16' | 'q8_0' | 'q4_0';
  gpuLayers: number | 'all';
  /** The sub-agents of the built-in engine (task 8.3): one after another in one slot, or in parallel in two. */
  subagents: 'sequential' | 'parallel';
}

/** The launch settings a person changes in the window: each restarts the engine, its cost said first. */
export type LaunchChange = Partial<Pick<EngineLaunchSettings, 'nCtx' | 'cacheType' | 'subagents'>>;

/** Changing model, said before (task 7.4): to what, from what (null when none runs), and what it costs. */
export interface ModelSwitchView {
  to: { path: string; name: string };
  from: { path: string; name: string } | null;
  announcement: ModelSwitchAnnouncement;
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
  /**
   * What changing to the model at `path` costs (task 7.4), said before anything is paid: its load, the
   * conversation `conversationId` read again for it, the video memory now and after. Loads nothing.
   */
  modelSwitch(path: string, conversationId?: string): Promise<ModelSwitchView>;
  /**
   * Changes model (« Changer »): the memory saved, the model loaded — the conversation goes on in it at its
   * next message. `as: 'copy'` (« Brancher sur ce modèle »): a new conversation from `conversationId` goes on
   * in it, the original keeps its model. Refused while a reply runs.
   */
  switchModel(path: string, options?: { conversationId?: string; as?: 'here' | 'copy' }): Promise<{ state: EngineState; conversationId?: string }>;
  /** The settings llama.cpp is launched with, as kept. */
  engineSettings(): Promise<EngineLaunchSettings>;
  /** What changing them costs, said before anything is kept (task 7.4; board « Coûts annoncés », 6). */
  restartCost(changes: LaunchChange): Promise<RestartAnnouncement>;
  /**
   * Keeps them. `restart`: the engine relaunches with them — at once, or when the reply that runs ends (the
   * memory saved first); without, or with no model loaded: at the next load.
   */
  applyEngineSettings(changes: LaunchChange, options: { restart: boolean }): Promise<void>;
  /** A turn in progress: the model is not unloaded while one is held. */
  hold(): () => void;
  /** Each turn that ends — answered, waiting for the person, or failed (task 8.5); returns how to stop listening. */
  onTurnEnd(listener: (end: TurnEnd) => void): () => void;
  stop(): Promise<void>;
  /** The llama.cpp a load runs, and — when asked — whether a newer build is published (GitHub). */
  llamaCpp(options?: { checkLatest?: boolean }): Promise<LlamaCppState>;
  /** Downloads the newest build, verifies it, and keeps it. Only when the person asks. */
  installLlamaCpp(): Promise<LlamaCppState>;
  /** The models bonaparte recommends for this machine's memory (task 9.5): asks nothing of the hub. */
  recommendedModels(): Promise<RecommendedModel[]>;
  /** Downloads one of them, verifies it, keeps it in `<data>/models`: only when the person asks. */
  downloadModel(id: string): Promise<RecommendedModel>;
  /** `bonaparte doctor` (task 9.6): Node, llama.cpp as a load would find it, the memories' folder, the card. Loads nothing. */
  doctor(): Promise<DoctorReport>;
  /** The conversations: their cards, their journals, their turns on the engine. */
  readonly conversations: ConversationEngine;
  readonly conversationStore: ConversationStore;
  /** The one registry of tools, and the one approval policy. */
  readonly tools: ToolRegistry;
  readonly permissions: PermissionEngine;
  /** The plugins: their tools join the registry, what they reach is judged by the same policy. */
  readonly plugins: PluginHost;
  /** The MCP servers (task 10.5): their tools join the registry at the first turn, judged by the same policy. */
  readonly mcp: McpService;
  /**
   * What a project runs (task 10.3): its scripts and services, for the browser's new tab — the project's of a
   * conversation, or a project named; a launch's output goes to that conversation's terminal.
   */
  readonly runs: {
    list(scope: RunScope): Promise<{ projectName: string | null; runs: RunView[]; alreadyRunning: string[] }>;
    start(scope: RunScope, kind: RunView['kind'], name: string): Promise<void>;
    stop(scope: RunScope, name: string): Promise<void>;
  };
  /** What each turn wrote, its originals kept: « Revenir » (6.4) and the rewind (7.1) take it back. */
  readonly checkpoints: CheckpointStore;
  /** The « Fichiers » pane: a perimeter listed and read — a conversation's, a project's, or the home folder. */
  readonly files: {
    list(scope: FileScope, dir: string | null): Promise<FileEntry[]>;
    read(scope: FileScope, path: string): Promise<FileText>;
    /** What the conversation changed and still stands. */
    changed(conversationId: string): Promise<ChangedFile[]>;
  };
  /** A conversation's own branch (task 6.7): its name, its folder, what it counts against its base; null without one. */
  branchOf(conversationId: string): Promise<{ name: string; base: string; worktree: string } & BranchStatus | null>;
  /** The pull request of a conversation's branch, and its CI (task 6.8): none without one, or without GitHub's CLI. */
  prOf(conversationId: string): Promise<PrStatus | null>;
  /** « À traiter » (task 8.4): what waits for the person, across the conversations. */
  inbox(): Promise<Inbox>;
  /** « Ouvrir une PR », on the person's word: the branch pushed, its pull request opened. */
  openPr(conversationId: string): Promise<PrStatus | null>;
  /** What archiving a conversation on its branch would leave uncommitted: its files. */
  uncommitted(conversationId: string): Promise<number>;
  /** « Commiter d'abord »: everything in its worktree committed. */
  commitBranch(conversationId: string, message: string): Promise<boolean>;
  /** Archived or taken out of it: its worktree let go, or held again; kept 30 days, then removed. */
  conversationArchived(conversationId: string, archived: boolean): Promise<void>;
  /** What going back before a message would move — said before the person decides; nothing moved. */
  rewindPreview(conversationId: string, target: RewindTarget): Promise<RewindPreview>;
  /** Going back before a message (task 7.1): what it put back, the branch shown from now on. */
  rewind(conversationId: string, target: RewindTarget, what: RewindWhat, options?: { messageId?: string }): Promise<RewindResult>;
  /**
   * Compaction (task 7.3): the conversation summarised and rebased — or why not (nothing changed then).
   */
  compact(conversationId: string): Promise<({ ok: true } & CompactResult) | { ok: false; reason: CompactionRefusal }>;
  /** « Relire et continuer » (task 8.4): the conversation read again now, its cost said first; the engine held. */
  readAgain(conversationId: string): Promise<void>;
  /** « Restaurer » a compaction: the conversation goes on from before its last rebase, on a branch. */
  uncompact(conversationId: string): Promise<string>;
  /** The context nearly full (from 90 %), with what compacting would take; null below. */
  contextOf(conversationId: string): Promise<Extract<Announcement, { kind: 'context-full' }> | null>;
  /** The branches of a conversation (« Brancher », task 7.2): listed, one shown, the sibling picked followed. */
  readonly branches: Branches;
  /** « Annuler le retour »: until the conversation's next turn begins; null when nothing is left to undo. */
  undoRewind(conversationId: string): Promise<{ branchId: string; filesRestored: string[]; conflicts: string[] } | null>;
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
  /** The built-in engine and the services added (task 9.1). */
  readonly providers: {
    list(): Promise<ProviderView[]>;
    /** What answers at an address: llama.cpp, an OpenAI-compatible service, or nothing usable — said within 5 s. */
    probe(url: string, key?: string): Promise<ProbeResult>;
    add(service: NewProvider, key?: string): Promise<ProviderView>;
    remove(id: string): Promise<void>;
    /** The models a service offers now, asked with its key; empty when it does not answer. */
    models(id: string): Promise<string[]>;
    /** The core's own use: a service's key, never handed to the window. */
    keyOf(id: string): Promise<string | undefined>;
  };
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
  /** The service a conversation runs on (task 9.2), when it is not the built-in engine's. */
  serviceOf(conversationId: string): Promise<Provider | undefined>;
  /**
   * A conversation not started yet goes to the service and model the person picked (task 9.3); one that has
   * begun keeps its own. False when the provider is not a service the core knows.
   */
  startOnService(conversationId: string, providerId: string, model: string): Promise<boolean>;
  /**
   * A conversation goes to a service between two turns (task 9.3): it leaves without its memory — the built-in
   * engine's stays saved —, and the journal says from where (an `engine` entry, no family). Back to the built-in
   * engine is `switchModel`, which renders it again for its model.
   */
  switchProvider(conversationId: string, providerId: string, model: string): Promise<void>;
  /**
   * « Travailler dans un projet… » (task 9.7): a discussion becomes a code conversation of the project, in its
   * default mode. Nothing is read again: its next turn tells the tools, the folders and the mode as notes.
   */
  attachProject(conversationId: string, projectId: string): Promise<void>;
  /** A turn of a conversation on a service: aparté's own loop, the core's tools and policy (task 9.2). */
  turnOnService(conversationId: string, raw: Record<string, unknown>, request: Request): Promise<Response>;
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
  // The services' keys: the system's vault, else nowhere — a key is refused rather than written in clear.
  const vault: SecretStore = deps.secrets ?? {
    get: async () => undefined,
    has: async () => false,
    delete: async () => undefined,
    set: async () => {
      throw new Error('No vault on this machine: the key cannot be kept.');
    },
  };
  const providerRegistry = new ProviderRegistry(join(deps.dataDir, 'config', 'providers.json'), vault);
  const viewOf = async (provider: Provider): Promise<ProviderView> => ({
    ...provider,
    hasKey: provider.kind === 'builtin' ? false : await providerRegistry.hasKey(provider.id),
  });
  const diskScan = new DiskScan(deps.diskRoots ?? (() => diskRoots()), async (folders) => void (await addModelFolders(folders)));
  // Where the core says what went wrong without failing: the supervisor's own default.
  const log = deps.logger ?? ((line: string) => console.log(line));
  // Minutes without work before the model is unloaded: the setting, followed as it changes (task 7.4).
  let idleMinutes = settingDefault('idleUnloadMinutes') as number;
  const readIdle = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) idleMinutes = value;
  };
  void appSettings.get('idleUnloadMinutes').then(readIdle, () => undefined);
  appSettings.onChange((key, value) => {
    if (key !== 'idleUnloadMinutes') return;
    readIdle(value);
    // « Jamais » chosen while a delay runs stops it (review of phase 7).
    supervisor.rearmIdle();
  });
  // An unload under way: no new turn is served — it would be cut under it (review of phase 7).
  let unloading = false;
  // The model unloaded last, said so that « Charger et envoyer » brings it back.
  let unloaded: { path: string; at: string; idleMinutes?: number } | undefined;
  const supervisor = new EngineSupervisor({
    slotsDir: kvDir,
    pidFile: join(engineDir, 'managed-server.pid'),
    measures,
    // Unloading after a while without work: the window says it, and « Charger et envoyer » announces the reload.
    idleUnloadMinutes: () => idleMinutes,
    onIdleUnload: (minutes) => {
      if (loaded) unloaded = { path: loaded.path, at: new Date().toISOString(), idleMinutes: minutes };
      loaded = undefined;
      deps.engineChanged?.();
    },
    ...(deps.port !== undefined ? { port: deps.port } : {}),
    ...(deps.llamaCommand ? { llamaCommand: deps.llamaCommand } : {}),
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    // Another model replaces this one: the memory the engine holds is saved first, while it still serves.
    beforeUnload: () => conversations.flush(),
  });
  // The window reads the engine again whenever it changes: started, ready, stopped, gone.
  supervisor.onStatusChange(() => deps.engineChanged?.());

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
    const subagents = await appSettings.get('subagentsOnBuiltin').catch(() => 'sequential');
    return {
      nCtx: read.engine?.nCtx ?? (settingDefault('nCtx') as number),
      cacheType: (read.engine?.cacheType ??
        settingDefault('cacheType')) as KvCacheType,
      gpuLayers: (read.engine?.gpuLayers ?? settingDefault('gpuLayers')) as
        number | 'all',
      subagents: (subagents === 'parallel' ? 'parallel' : 'sequential') as EngineLaunchSettings['subagents'],
    };
  }

  /** The slots llama.cpp runs: one, or two when the sub-agents work in parallel (task 8.3). */
  const slotsFor = (launch: { subagents: EngineLaunchSettings['subagents'] }): number => (launch.subagents === 'parallel' ? 2 : 1);

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
  async function configuredManaged(forPath?: string): Promise<EngineConfig> {
    const binPath = await llamaBinary();
    const current = supervisor.engine;
    const launch = await launchSettings();
    // Settings kept since (task 7.4) or a build installed since: taken at the next load, never under a model
    // that runs.
    const same =
      current?.mode === 'managed' &&
      current.binPath === binPath &&
      current.nCtx === launch.nCtx &&
      (current.cacheType ?? 'f16') === launch.cacheType &&
      (current.gpuLayers ?? 'all') === launch.gpuLayers &&
      (current.slots ?? 1) === slotsFor(launch);
    // Kept as it is while the model that runs stays; another model takes the settings kept since, as its
    // announcement said (review of phase 7) — the memory of the one that runs saved first, as a load does.
    const stays = supervisor.loaded !== null && (forPath === undefined || samePath(supervisor.loaded.modelPath, forPath));
    if (current?.mode === 'managed' && (same || stays)) return current;
    if (supervisor.loaded) {
      await conversations.flush().catch((error: unknown) => log(`[bonaparte] a memory was not saved: ${String(error)}`));
    }
    const { subagents: _subagents, ...settings } = launch;
    await supervisor.configure({
      mode: 'managed',
      binPath,
      ...settings,
      slots: slotsFor(launch),
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

  // ── The models bonaparte recommends, downloaded on demand (task 9.5) ──
  const ownModels = join(deps.dataDir, 'models');
  const catalogue = deps.modelCatalogue ?? CATALOGUE;
  const hub = deps.modelHub === undefined ? 'https://huggingface.co' : deps.modelHub;
  const downloads = new Map<string, { progress: { done: number; total: number | null }; done: Promise<RecommendedModel> }>();

  async function recommendedView(entry: CatalogueEntry): Promise<RecommendedModel> {
    const path = join(ownModels, entry.file);
    return {
      id: entry.id,
      family: entry.family,
      name: entry.name,
      file: entry.file,
      bytes: entry.bytes,
      context: entry.context,
      path: (await access(path).then(() => true, () => false)) ? path : null,
      downloading: downloads.get(entry.id)?.progress ?? null,
    };
  }

  async function recommended(): Promise<RecommendedModel[]> {
    return Promise.all(recommendedModels(await gpuBytes(), catalogue).map(recommendedView));
  }

  function downloadModel(id: string): Promise<RecommendedModel> {
    const running = downloads.get(id);
    if (running) return running.done;
    const entry = catalogue.find((one) => one.id === id);
    if (!entry) return Promise.reject(new Error(`« ${id} » is not one bonaparte recommends: only those are downloaded.`));
    if (hub === null) return Promise.reject(new Error('There is no hub to download a model from.'));
    const job = { progress: { done: 0, total: entry.bytes as number | null }, done: Promise.resolve() as unknown as Promise<RecommendedModel> };
    job.done = (async () => {
      try {
        await mkdir(ownModels, { recursive: true });
        await downloadFile({
          url: modelUrl(entry, hub),
          dest: join(ownModels, entry.file),
          sha256: entry.sha256,
          onProgress: (progress) => (job.progress = progress),
        });
      } finally {
        downloads.delete(id);
      }
      return recommendedView(entry);
    })();
    downloads.set(id, job);
    return job.done;
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
    // The server says « ready » as soon as it answers; the core serves a turn only once it knows the model it
    // loaded: until then, still starting — a window told « ready » may send at once (task 7.4).
    const raw = supervisor.status();
    const serving =
      engine.mode === 'remote' || (!unloading && model !== null && loaded !== undefined && samePath(loaded.path, model.modelPath));
    return {
      mode: engine.mode,
      status: raw === 'ready' && !serving ? 'starting' : raw,
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
              ...(engine.mode === 'managed' ? { slots: supervisor.engine?.mode === 'managed' ? (supervisor.engine.slots ?? 1) : 1 } : {}),
            },
          }
        : {}),
      ...(engine.mode === 'managed' && !model ? await resumeOf() : {}),
      ...(conversations.subagentAtWork !== null ? { working: { subagent: conversations.subagentAtWork } } : {}),
    };
  }

  /** The model a load would bring back, when nothing runs: the one unloaded, else the default one, else the last loaded. */
  async function resumeOf(): Promise<Pick<EngineState, 'resume'>> {
    const there = async (path: string): Promise<boolean> => access(path).then(() => true, () => false);
    if (unloaded && (await there(unloaded.path))) {
      return {
        resume: {
          path: unloaded.path,
          name: nameOf(unloaded.path),
          unloadedAt: unloaded.at,
          ...(unloaded.idleMinutes !== undefined ? { idleMinutes: unloaded.idleMinutes } : {}),
        },
      };
    }
    const preferred = await appSettings.get('defaultModel').catch(() => '');
    for (const path of [typeof preferred === 'string' ? preferred : '', measures.lastLoaded() ?? '']) {
      if (path && (await there(path))) return { resume: { path, name: nameOf(path) } };
    }
    return {};
  }

  /** Where models are looked for: the known folders, and the ones the person added (Settings, Models). */
  async function modelRoots(): Promise<ScanRoot[]> {
    const added = await appSettings.get('modelFolders').catch(() => []);
    const folders = Array.isArray(added) ? added.filter((dir): dir is string => typeof dir === 'string') : [];
    return [
      // The models bonaparte downloaded (task 9.5), wherever the others are looked for.
      { dir: ownModels, source: 'bonaparte' as const },
      ...(deps.modelRoots ?? defaultScanRoots(env)),
      ...folders.map((dir) => ({ dir, source: 'custom' as const })),
    ];
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
            // In parallel, the second slot's KV cache too (review of phase 8).
            { ...settings, slots: slotsFor(settings) },
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
  ): Promise<{ roots: string[]; projectId?: string; barred?: string[] }> {
    const meta = await conversationStore.get(conversationId);
    const project = meta?.projectId ? await projectStore.get(meta.projectId) : undefined;
    if (!project) return { roots: perimeter() };
    projectRoots.set(project.id, project.roots);
    // On its own branch: the project's folders in its worktree; their own checkout never written.
    if (meta?.worktree) return { ...branchRoots(project.roots, meta.worktree), projectId: project.id };
    return { roots: project.roots, projectId: project.id };
  }
  // GitHub's CLI (task 6.8): `gh` unless the deps say otherwise; null for none.
  const gh = deps.gh === undefined ? ['gh'] : deps.gh;
  const PR_FRESH_MS = 20_000;
  const prs = new Map<string, { at: number; pr: PrStatus | null }>();
  const repoOf = async (meta: { projectId?: string }): Promise<string | null> => {
    const project = meta.projectId ? await projectStore.get(meta.projectId) : undefined;
    return project?.roots[0] ? repoRoot(project.roots[0]) : null;
  };
  // An archived conversation keeps its folder and its branch 30 days; then both go.
  const ARCHIVE_KEEP_MS = 30 * 24 * 3600 * 1000;
  void conversationStore
    .list()
    .then(async (metas) => {
      for (const meta of metas) {
        if (!meta.worktree || !meta.branch || !meta.archivedAt) continue;
        if (Date.parse(meta.archivedAt) > Date.now() - ARCHIVE_KEEP_MS) continue;
        const repo = await repoOf(meta);
        if (!repo) continue;
        // Work never committed there (a pull request merged meanwhile) is the person's: kept.
        if ((await uncommittedFiles(meta.worktree)) > 0) continue;
        await removeWorktree(repo, meta.worktree, meta.branch);
        await conversationStore.update(meta.id, { worktree: undefined });
      }
    })
    .catch(() => undefined);
  // A conversation on its own branch gets its worktree at its first write (task 6.7) — once,
  // whatever the calls of that turn.
  // Whatever stops it is said to the model as the call's result; the turn goes on.
  const branching = new Map<string, Promise<ChangePlace | undefined>>();
  const ensureBranch = (conversationId: string): Promise<ChangePlace | undefined> => {
    const running = branching.get(conversationId);
    if (running) return running;
    const made = (async (): Promise<ChangePlace | undefined> => {
      const meta = await conversationStore.get(conversationId);
      if (!meta || meta.worksIn !== 'branch' || meta.worktree || !meta.projectId) return undefined;
      const project = await projectStore.get(meta.projectId);
      const repo = project?.roots[0] ? await repoRoot(project.roots[0]) : null;
      // Never into the project's own folder instead.
      if (!project || !repo) return { error: 'This conversation works on its own branch, and its project is not in a git repository any more: it changes nothing.' };
      const prefix = String((await appSettings.get('branchPrefix').catch(() => 'bonaparte/')) ?? 'bonaparte/');
      const asked = meta.branch ?? `${prefix}${conversationId.slice(0, 8)}`;
      const name = asked.split('/').pop() || conversationId.slice(0, 8);
      // `HEAD` as a base is the branch checked out now, so that what is counted against it stays put.
      const base = meta.base && meta.base !== 'HEAD' ? meta.base : (await currentBranch(repo)) || 'HEAD';
      try {
        const worktree = await createWorktree({ repo, name, base, prefix: asked.slice(0, asked.length - name.length), copy: ['.env'] });
        await conversationStore.update(conversationId, { worktree: worktree.dir, branch: worktree.branch, base });
        return branchRoots(project.roots, worktree.dir);
      } catch (error) {
        return { error: `This conversation could not make its own branch, and changes nothing: ${error instanceof Error ? error.message : String(error)}` };
      }
    })().finally(() => branching.delete(conversationId));
    branching.set(conversationId, made);
    return made;
  };
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
    // And what a command prints, for the terminal's agent tab.
    onOutput: (event: CommandOutputEvent) => deps.commandOutput?.(conversationId, event),
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
  // The web search a network plugin asks (task 10.4): the provider the person chose, the public engine by
  // default; an online provider's key read from the vault, never from a setting.
  const webSearch = createWebSearch({
    ...(deps.webSearch ? { embedded: deps.webSearch } : {}),
    provider: async () => (await appSettings.get('webSearchProvider').catch(() => 'embedded')) as SearchProvider,
    key: async (provider: OnlineProvider) => (await deps.secrets?.get(`search-${provider}`)) ?? undefined,
    searxngUrl: async () => String(await appSettings.get('webSearchUrl').catch(() => '')),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  // The MCP servers (task 10.5): nothing starts with the app; the first turn starts them.
  const mcp = new McpService({
    dataDir: deps.dataDir,
    registry: tools,
    env: () => withoutSecrets(process.env),
    log,
    // A server's keys: the system's vault, else the server is refused rather than written in clear.
    secrets: vault,
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
  });
  // What a project runs (task 10.3): launched on a click, their output to the conversation's terminal.
  const projectRuns = new ProjectRuns({
    env: () => withoutSecrets(process.env),
    output: (event, conversationId) => {
      if (conversationId) deps.commandOutput?.(conversationId, event);
    },
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
  });
  /** The folder a scope's project runs in: the conversation's (its worktree included), else the project's first. */
  async function runRoot(scope: RunScope): Promise<{ root: string; name: string } | null> {
    if (scope.conversationId && (await conversationStore.get(scope.conversationId))) {
      const place = await rootsOf(scope.conversationId);
      const project = place.projectId ? await projectStore.get(place.projectId) : undefined;
      return project && place.roots[0] ? { root: place.roots[0], name: project.name } : null;
    }
    const project = scope.projectId ? await projectStore.get(scope.projectId) : undefined;
    return project?.roots[0] ? { root: project.roots[0], name: project.name } : null;
  }
  // What a conversation of a project sees: the plugins it keeps, the MCP servers of the app and its own.
  const visibleTo = (projectId: string | undefined) => {
    const byPlugins = plugins.visibleTo(projectId);
    const byServers = mcp.visibleTo(projectId);
    return (def: ToolDef) => byPlugins(def) && byServers(def);
  };
  const plugins = new PluginHost({
    registry: tools,
    log,
    webSearch,
    ...(deps.browser ? { browser: deps.browser } : {}),
    ...(deps.terminals ? { terminals: deps.terminals } : {}),
    ...(deps.pluginEvent ? { emit: deps.pluginEvent } : {}),
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
        ...(loaded && live ? { slidingWindow: loaded.info.slidingWindow } : {}),
        // The slots the server was launched with (task 8.3); one for a server that runs elsewhere.
        slots: live && supervisor.engine?.mode === 'managed' ? (supervisor.engine.slots ?? 1) : 1,
      };
    },
    prompt: (meta) => ({
      kind: meta.kind,
      tools: toolsFor(meta.kind, tools.view(visibleTo(meta.projectId)).list()),
      perimeter: !meta.projectId
        ? []
        : meta.worktree
          ? projectRoots.has(meta.projectId)
            ? branchRoots(projectRoots.get(meta.projectId)!, meta.worktree).roots
            : [meta.worktree]
          : (projectRoots.get(meta.projectId) ?? []),
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
  // A sub-agent takes the engine, or leaves it: the card says who works there (task 8.2).
  conversations.onSubagentAtWork(() => deps.engineChanged?.());
  // The branches of a conversation (task 7.2): « Brancher », and the sibling the person picks in the chat.
  const branches = createBranches({
    engine: conversations,
    store: conversationStore,
    family: () => loaded?.layer ?? remoteFamily ?? familyLayer('gemma'),
  });
  // Going back before a message (task 7.1): the files by the checkpoints, the conversation by a branch.
  const rewinds = createRewind({
    engine: conversations,
    checkpoints,
    store: conversationStore,
    family: () => loaded?.layer ?? remoteFamily ?? familyLayer('gemma'),
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
    // The first turn starts the MCP servers, in the background: their tools are told at the next turn (task 10.5).
    mcp.startAll();
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
    const { roots, projectId, barred } = await rootsOf(conversationId);
    // Only the tools its kind is told of: a discussion's call to a file tool finds none (task 9.7).
    const kind = (await conversationStore.get(conversationId))?.kind ?? 'code';
    const visible = visibleTo(projectId);
    const told = new Set(toolsFor(kind, tools.view(visible).list()).map((tool) => tool.name));
    // Whatever becomes of the turn, what it wrote is found by « Rechercher » at once.
    try {
      const result = await runAgentTurn(
        {
          conversationId,
          input,
          mode: (await modeOf(conversationId)).mode,
          ...(projectId ? { projectId } : {}),
          registry: tools.view((def) => visible(def) && told.has(def.name)),
          permissions,
          conversations,
          roots,
          ...(barred ? { barred } : {}),
          nCtx: supervisor.loaded?.nCtx ?? (settingDefault('nCtx') as number),
          windowTools,
          ...keepOriginals(conversationId, input.messageId ?? 'turn'),
          beforeChange: () => ensureBranch(conversationId),
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
      await tellTurnEnd(conversationId, result);
      return result;
    } catch (error) {
      // A failure under the turn is told; a stop, or a turn refused before it ran, is the person's own doing.
      if (!options.signal.aborted && !(error instanceof ContextFullError) && !(error instanceof NoEngineError)) {
        await tellTurnEnd(conversationId, 'failed');
      }
      throw error;
    } finally {
      await index.refresh(conversationId).catch(() => undefined);
    }
  }

  async function serviceOf(conversationId: string): Promise<Provider | undefined> {
    const meta = await conversationStore.get(conversationId);
    if (!meta || meta.engineId === BUILTIN_PROVIDER.id) return undefined;
    const provider = await providerRegistry.get(meta.engineId);
    return provider?.kind === 'openai-compat' ? provider : undefined;
  }

  async function startOnService(conversationId: string, providerId: string, model: string): Promise<boolean> {
    const provider = await providerRegistry.get(providerId);
    if (provider?.kind !== 'openai-compat' || !model) return false;
    const meta = await conversationStore.ensure(conversationId, { kind: 'code', engineId: provider.id, modelId: model, mode: 'repetition' });
    if ((await openJournal(conversationStore.dir, conversationId, meta.branchId)).entries().length > 0) return false;
    await conversationStore.update(conversationId, { engineId: provider.id, modelId: model });
    // From its first entry, the journal says it runs on the service: back on the built-in engine, it is rendered
    // again for its model (task 9.3).
    await (await openJournal(conversationStore.dir, conversationId, meta.branchId)).append({ kind: 'engine', engineId: provider.id, modelId: model });
    return true;
  }

  async function attachProject(conversationId: string, projectId: string): Promise<void> {
    const project = await projectStore.get(projectId);
    if (!project) throw new Error(`No project ${projectId}.`);
    const meta = await conversationStore.get(conversationId);
    if (!meta) throw new Error(`No conversation ${conversationId}.`);
    await conversationStore.update(conversationId, { kind: 'code', projectId: project.id });
    projectRoots.set(project.id, project.roots);
    await core.setMode(conversationId, project.defaultMode ?? 'repetition', { confirmed: false });
  }

  async function switchProvider(conversationId: string, providerId: string, model: string): Promise<void> {
    const provider = await providerRegistry.get(providerId);
    if (provider?.kind !== 'openai-compat') throw new Error(`Not a service: ${providerId}.`);
    if (!model) throw new Error('A service is asked a model.');
    if (supervisor.held) throw new EngineBusyError();
    const meta = await conversationStore.get(conversationId);
    if (!meta) throw new Error(`No conversation ${conversationId}.`);
    if (meta.engineId === provider.id && meta.modelId === model) return;
    await (await openJournal(conversationStore.dir, conversationId, meta.branchId)).append({ kind: 'engine', engineId: provider.id, modelId: model });
    await conversationStore.update(conversationId, { engineId: provider.id, modelId: model });
  }

  async function turnOnService(conversationId: string, raw: Record<string, unknown>, request: Request): Promise<Response> {
    mcp.startAll();
    const meta = await conversationStore.get(conversationId);
    const provider = await serviceOf(conversationId);
    if (!meta || !provider) throw new Error(`The conversation ${conversationId} is not on a service.`);
    const place = await rootsOf(conversationId);
    const { mode } = await modeOf(conversationId);
    const registry = tools.view(visibleTo(place.projectId));
    const project = place.projectId ? await projectStore.get(place.projectId) : undefined;
    const instructions = project ? ((await readProjectInstructions(project.roots))?.text ?? '') : '';
    const messageId = typeof raw['messageId'] === 'string' ? raw['messageId'] : 'turn';
    const originals = keepOriginals(conversationId, messageId);
    // What the turn says is kept in the journal, the truth (task 9.2): the message, then the answer — nothing
    // frozen, no `rendered`: a service keeps no memory, and the built-in engine would read it again.
    let journal = await openJournal(conversationStore.dir, conversationId, meta.branchId);
    const resume = raw['resume'] as { outcomes?: Record<string, Outcome> } | undefined;
    if (resume) {
      // The pause answered: the conversation no longer waits (« À traiter », the row's mark).
      if (journal.entries().at(-1)?.kind === 'pending' && resume.outcomes) await journal.append({ kind: 'outcomes', outcomes: resume.outcomes });
    } else {
      // Compared with the journal as on the built-in engine (review of phase 9): a new message is added; an answer
      // asked again or a message changed branches the journal, so that it says what the window shows.
      const request = raw['request'] as { messages?: AgentMessage[]; _meta?: { historySummary?: string } } | undefined;
      const divergence = compareWithJournal(request?.messages ?? [], journal.entries(), request?._meta?.historySummary);
      if (divergence.kind === 'mismatch') {
        return new Response(JSON.stringify({ error: { message: 'This history is not the one of this conversation: open it again.' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (divergence.kind !== 'append') {
        journal = await journal.fork(divergence.afterEntryId);
        await conversationStore.update(conversationId, { branchId: journal.branchId });
      }
      if (divergence.kind !== 'retry') await journal.append({ kind: 'user', text: divergence.text, messageId });
    }
    let answer = '';
    // Stopped by the person: never told as an end.
    let aborted = false;
    return serveOnService(
      {
        provider,
        key: await providerRegistry.keyOf(provider.id),
        model: meta.modelId,
        tools: toolsFor(meta.kind, registry.list()),
        run: async (call, signal) => {
          const def = registry.get(call.name)?.def;
          let roots = place.roots;
          // A change waits for its conversation's own branch (task 6.7), as on the built-in engine.
          if (def && (def.effect === 'write' || def.effect === 'execute')) {
            const moved = await ensureBranch(conversationId);
            if (moved && 'error' in moved) return { toolCallId: call.id, name: call.name, content: moved.error, failed: true };
            if (moved) roots = [...moved.roots];
          }
          // A service's context is not known: the output is cut as for a context of 32 k.
          return registry.run(call, { conversationId, roots, nCtx: 32_768, signal, ...originals });
        },
        judge: (tool, input) =>
          permissions.evaluate({
            tool,
            input,
            mode,
            ...(place.projectId ? { projectId: place.projectId } : {}),
            roots: place.roots,
            ...(place.barred ? { barred: place.barred } : {}),
          }),
        system: buildServicePrompt({
          kind: meta.kind,
          perimeter: place.projectId ? place.roots : [],
          replyLanguage: deps.replyLanguage?.() ?? 'English',
          ...(instructions ? { projectInstructions: instructions } : {}),
        }),
        secret: (await installationSecret(deps.dataDir)).toString('hex'),
        maxTurns: Number(await appSettings.get('maxToolRounds').catch(() => 25)) || 25,
      },
      raw,
      request,
      (line) => {
        if (line.type === 'text-delta' && line['agentId'] === undefined) answer += String(line['delta'] ?? '');
        const usage = (line['usage'] as Usage | undefined) ?? { inputTokens: 0, outputTokens: 0 };
        // Its end told as every turn's (review of phase 9): the notifications, the tray, « À traiter ».
        if (line.type === 'run-done' && !aborted) {
          return (answer ? journal.append({ kind: 'assistant', raw: answer, messageId }) : Promise.resolve())
            .then(() => tellTurnEnd(conversationId, { usage }))
            .catch((error: unknown) => log(`[bonaparte] the answer of ${conversationId} was not journaled: ${String(error)}`));
        }
        if (line.type === 'run-suspended') {
          const pending = (line['pending'] as PendingCall[] | undefined) ?? [];
          const ticket = String(line['ticket'] ?? '');
          // The pause is kept, as on the built-in engine: the row says it waits, « À traiter » lists it.
          return journal
            .append({ kind: 'pending', calls: pending, ticket })
            .then(() => tellTurnEnd(conversationId, { usage, suspended: { pending, ticket } }))
            .catch((error: unknown) => log(`[bonaparte] the pause of ${conversationId} was not journaled: ${String(error)}`));
        }
        if (line.type === 'run-aborted') aborted = true;
        if (line.type === 'run-error') return tellTurnEnd(conversationId, 'failed');
        return undefined;
      },
    );
  }

  // Each turn that ends, told to whoever listens: the main process's notifications (task 8.5).
  const turnEnds = new Set<(end: TurnEnd) => void>();
  async function tellTurnEnd(conversationId: string, outcome: TurnResult | 'failed'): Promise<void> {
    if (turnEnds.size === 0 || (outcome !== 'failed' && outcome.stopped)) return;
    const end = await turnEndOf(conversationId, outcome).catch((error: unknown) => {
      log(`[bonaparte] the end of a turn could not be read: ${String(error)}`);
      return null;
    });
    if (!end) return;
    for (const listener of turnEnds) {
      try {
        listener(end);
      } catch (error) {
        log(`[bonaparte] a listener of the turns failed: ${String(error)}`);
      }
    }
  }
  async function turnEndOf(conversationId: string, outcome: TurnResult | 'failed'): Promise<TurnEnd | null> {
    const meta = await conversationStore.get(conversationId);
    const place = { conversationId, title: meta?.title ?? '' };
    if (outcome === 'failed') return { ...place, how: 'failed' };
    if (outcome.suspended) {
      const asked = outcome.suspended.pending.filter((call) => call.reason !== 'queued');
      const approval = asked.find((call) => call.reason === 'approval');
      if (approval) {
        const hold = approval.agentId ? outcome.suspended.subagents?.find((one) => one.agentId === approval.agentId) : undefined;
        const named = (hold?.input as Record<string, unknown> | undefined)?.['name'];
        return {
          ...place,
          how: 'approval',
          call: { name: approval.name, input: approval.input },
          ...(typeof named === 'string' && named ? { agent: named } : {}),
        };
      }
      const question = asked.find((call) => call.reason === 'external');
      if (!question) return null;
      const words = (question.input as Record<string, unknown> | undefined)?.['question'];
      return { ...place, how: 'question', question: typeof words === 'string' ? words : '' };
    }
    if (!meta) return null;
    const entries = (await openJournal(conversationStore.dir, conversationId, meta.branchId)).entries();
    const answer = entries.findLast((entry) => entry.kind === 'assistant');
    return { ...place, how: 'done', said: answer?.kind === 'assistant' ? saidIn(answer.raw, branchModel(entries).family) : '' };
  }

  // A restart asked under a reply: done when the last hold is released (task 7.4).
  let restartPending = false;
  async function restartWhenIdle(): Promise<void> {
    if (!restartPending || supervisor.held || !loaded) return;
    restartPending = false;
    await core.restartEngine().catch((error: unknown) => log(`[bonaparte] the engine did not restart: ${String(error)}`));
  }

  const core: Core = {
    // The engine a new turn may run on: none while an unload is under way (its memory being saved first).
    engine: async () => (unloading ? undefined : currentEngine()),
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
      await configuredManaged(listed.path);
      if (!orphanChecked) {
        orphanChecked = true;
        await supervisor.killOrphan();
      }
      await supervisor.ensureLoaded(listed.path);
      loaded = { path: listed.path, info, layer, at: new Date().toISOString() };
      // The engine said « ready » while it started; it serves only now: the window is told again (7.4).
      deps.engineChanged?.();
      return engineState();
    },

    async modelSwitch(path, conversationId) {
      const listed = await models();
      const target = listed.find((model) => samePath(model.path, path));
      if (!target) throw new ModelNotListedError(path);
      if (!target.announcement) throw new Error(`The model ${target.name} cannot be read: it cannot be loaded.`);
      const layer = layerForModel(await readGgufInfo(target.path));
      const running = (await currentEngine()) && loaded ? listed.find((model) => samePath(model.path, loaded!.path)) : undefined;
      const rereadTokens = conversationId ? await conversations.rereadOn(conversationId, { family: layer, modelPath: target.path }) : 0;
      const prefill = measures.get(target.path)?.prefillTokensPerSecond;
      return {
        to: { path: target.path, name: target.name },
        from: running ? { path: running.path, name: running.name } : null,
        announcement: announceModelSwitch({
          load: target.announcement,
          rereadTokens,
          ...(prefill !== undefined ? { prefillTokensPerSecond: prefill } : {}),
          vramBytesNow: running?.announcement?.vramBytes ?? 0,
        }),
      };
    },

    async switchModel(path, options = {}) {
      // A reply in progress keeps its model: changing it would cut the answer.
      if (supervisor.held) throw new EngineBusyError();
      // Loaded first — the failure-prone step: a copy is made only for a model that runs.
      const state = await this.loadModel(path);
      // A conversation on a service comes back to the built-in engine (task 9.3): its next turn renders it again.
      if (options.as !== 'copy' && options.conversationId) {
        const meta = await conversationStore.get(options.conversationId);
        if (meta && meta.engineId !== BUILTIN_PROVIDER.id) await conversationStore.update(options.conversationId, { engineId: BUILTIN_PROVIDER.id, modelId: path });
      }
      if (options.as === 'copy' && options.conversationId && loaded) {
        const copy = await conversations.copy(options.conversationId, { family: loaded.layer, modelPath: loaded.path });
        return { state, conversationId: copy.id };
      }
      return { state, ...(options.conversationId ? { conversationId: options.conversationId } : {}) };
    },

    hold: () => {
      const release = supervisor.hold();
      return () => {
        release();
        void restartWhenIdle();
      };
    },

    onTurnEnd(listener) {
      turnEnds.add(listener);
      return () => void turnEnds.delete(listener);
    },

    async engineSettings() {
      return (await launchSettings()) as EngineLaunchSettings;
    },

    async restartCost(changes) {
      const current = (await launchSettings()) as EngineLaunchSettings;
      const next = { ...current, ...changes };
      // In parallel (task 8.3): one slot more, and what it holds — said beside the restart.
      const parallel =
        next.subagents === 'parallel' && current.subagents !== 'parallel'
          ? { slots: 2, vramBytesEach: loaded ? announceParallelSlots(loaded.info, next.nCtx, next.cacheType).vramBytesEach : null }
          : undefined;
      // The memories these settings would refuse that the current ones serve: those it makes to read again.
      const states = await kv.savedStates();
      const served = states.filter((state) => memoriesRefusedBy([state], current) === 0);
      const running = (await currentEngine()) && loaded ? (await models()).find((model) => samePath(model.path, loaded!.path)) : undefined;
      const restart = announceRestart({
        setting: Object.keys(changes)[0] ?? 'nCtx',
        loadSeconds: running?.announcement?.seconds ?? 0,
        loadEstimated: running?.announcement?.secondsEstimated ?? true,
        memoriesLost: memoriesRefusedBy(served, next),
        replyRunning: supervisor.held,
        loaded: running !== undefined,
      });
      return parallel ? { ...restart, parallel } : restart;
    },

    async applyEngineSettings(changes, options) {
      const { subagents, ...engine } = changes;
      if (Object.keys(engine).length > 0) await appSettings.setEngine(engine);
      // The sub-agents' setting is the app's (« Général »): it reaches the engine at its next launch (task 8.3).
      if (subagents !== undefined) await appSettings.set('subagentsOnBuiltin', subagents);
      // Read again at the next load: the file changed.
      config = undefined;
      if (!options.restart || !loaded) return;
      restartPending = true;
      await restartWhenIdle();
    },
    // The conversation in the slot is saved before the engine stops: its memory survives the restart.
    async stop() {
      await conversations
        .flush()
        .catch((error: unknown) =>
          log(`[bonaparte] a memory was not saved: ${String(error)}`),
        );
      await plugins.deactivateAll();
      // Every MCP server's whole tree goes down with the app, and what the projects launched.
      await mcp.stopAll();
      await projectRuns.stopAll();
      await supervisor.stop();
    },
    conversations,
    conversationStore,
    tools,
    permissions,
    plugins,
    mcp,
    runs: {
      async list(scope) {
        const place = await runRoot(scope);
        const alreadyRunning = await projectRuns.alreadyRunning();
        if (!place) return { projectName: null, runs: [], alreadyRunning };
        return { projectName: place.name, runs: (await projectRuns.list(place.root)).runs, alreadyRunning };
      },
      async start(scope, kind, name) {
        const place = await runRoot(scope);
        if (!place) throw new Error('There is no project to run anything in.');
        await projectRuns.start(place.root, kind, name, scope.conversationId);
      },
      async stop(scope, name) {
        const place = await runRoot(scope);
        if (place) await projectRuns.stop(place.root, name);
      },
    },
    checkpoints,

    files: {
      list: async (scope, dir) => listEntries(await scopeRoots(scope), dir, deps.home),
      read: async (scope, path) => readText(await scopeRoots(scope), path, undefined, deps.home),
      changed: (conversationId) => checkpoints.files(conversationId),
    },

    async inbox(this: Core) {
      return readInbox({ store: conversationStore, conversations, prOf: (id) => this.prOf(id) });
    },

    async prOf(conversationId) {
      const meta = await conversationStore.get(conversationId);
      if (!meta?.worktree || !meta.branch) return null;
      // Read at the end of a turn and while it is on screen — never more than once in a while.
      const cached = prs.get(conversationId);
      if (cached && cached.at > Date.now() - PR_FRESH_MS) return cached.pr;
      const pr = await prStatus(gh, meta.worktree, meta.branch);
      prs.set(conversationId, { at: Date.now(), pr });
      return pr;
    },

    async openPr(conversationId) {
      const meta = await conversationStore.get(conversationId);
      if (!meta?.worktree || !meta.branch || !meta.base) return null;
      const pr = await openPr(gh, meta.worktree, meta.branch, meta.base);
      prs.set(conversationId, { at: Date.now(), pr });
      return pr;
    },

    async uncommitted(conversationId) {
      const meta = await conversationStore.get(conversationId);
      return meta?.worktree ? uncommittedFiles(meta.worktree) : 0;
    },

    async commitBranch(conversationId, message) {
      const meta = await conversationStore.get(conversationId);
      return meta?.worktree ? commitAll(meta.worktree, message) : false;
    },

    branches,
    async compact(conversationId) {
      // The summary is a reply of the engine: it is neither unloaded nor restarted under it (review of phase 7).
      const release = core.hold();
      try {
        return { ok: true, ...(await conversations.compact(conversationId, () => undefined)) };
      } catch (error) {
        if (error instanceof CompactionError) return { ok: false, reason: error.code };
        throw error;
      } finally {
        release();
      }
    },
    async readAgain(conversationId) {
      // A prefill of the engine: neither unloaded nor restarted under it, like a compaction (review of phase 8).
      const release = core.hold();
      try {
        await conversations.readAgain(conversationId);
      } finally {
        release();
      }
    },
    uncompact: (conversationId) => conversations.uncompact(conversationId),
    contextOf: (conversationId) => conversations.contextOf(conversationId),
    rewindPreview: (conversationId, target) => rewinds.preview(conversationId, target),
    rewind: (conversationId, target, what, options) => rewinds.rewind(conversationId, target, what, options),
    undoRewind: (conversationId) => rewinds.undo(conversationId),

    async conversationArchived(conversationId, archived) {
      const meta = await conversationStore.get(conversationId);
      const repo = meta?.worktree ? await repoOf(meta) : null;
      if (!meta?.worktree || !repo) return;
      if (archived) await unlockWorktree(repo, meta.worktree);
      else await lockWorktree(repo, meta.worktree);
    },

    async branchOf(conversationId) {
      const meta = await conversationStore.get(conversationId);
      if (!meta?.worktree || !meta.branch || !meta.base) return null;
      return { name: meta.branch, base: meta.base, worktree: meta.worktree, ...(await branchStatus(meta.worktree, meta.base)) };
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
    providers: {
      list: async () => Promise.all((await providerRegistry.list()).map(viewOf)),
      probe: (url, key) => probeEndpoint(url, key === undefined ? {} : { key }),
      add: async (service, key) => viewOf(await providerRegistry.add(service, key)),
      remove: (id) => providerRegistry.remove(id),
      keyOf: (id) => providerRegistry.keyOf(id),
      models: async (id) => {
        const provider = await providerRegistry.get(id);
        if (!provider?.url) return [];
        const key = await providerRegistry.keyOf(id);
        const found = await probeEndpoint(provider.url, key === undefined ? {} : { key });
        return 'models' in found ? found.models : [];
      },
    },
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
          // What runs: a setting kept for later is not the engine's until it restarts (task 7.4).
          nCtx: running ? (supervisor.loaded?.nCtx ?? launch.nCtx) : launch.nCtx,
          cacheType: running ? (supervisor.live?.cacheTypeK ?? launch.cacheType) : launch.cacheType,
          slots: running && supervisor.engine?.mode === 'managed' ? (supervisor.engine.slots ?? 1) : 1,
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
      unloading = true;
      try {
        await conversations
          .flush()
          .catch((error: unknown) => log(`[bonaparte] a memory was not saved: ${String(error)}`));
        const was = loaded;
        await supervisor.stop();
        loaded = undefined;
        if (was) unloaded = { path: was.path, at: new Date().toISOString() };
      } finally {
        unloading = false;
      }
    },

    async restartEngine() {
      if (!loaded) throw new Error('No model runs: there is nothing to restart.');
      if (supervisor.held) throw new Error('A reply is running: the engine is not restarted under it.');
      const path = loaded.path;
      await this.unloadModel();
      await this.loadModel(path);
    },

    agentTurn,
    serviceOf,
    startOnService,
    switchProvider,
    attachProject,
    turnOnService,
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
      const scope = {
        conversationId,
        mode: (await modeOf(conversationId)).mode,
        ...(place.projectId ? { projectId: place.projectId } : {}),
        registry: tools.view(visibleTo(place.projectId)),
        permissions,
        place: { roots: place.roots, ...(place.barred ? { barred: place.barred } : {}) },
        nCtx: supervisor.loaded?.nCtx ?? (settingDefault('nCtx') as number),
        signal: options.signal,
        ...keepOriginals(conversationId, options.messageId),
        beforeChange: () => ensureBranch(conversationId),
      };
      // The sub-agents the pause holds go on, and those queued behind it run, on slots of their own (task 8.1).
      const parent = { ...scope, engine: conversations, emit };
      const { results, waiting, holds, letGo } = await answerPause(
        {
          ...scope,
          windowTools: new Set(options.clientTools.map((tool) => tool.name)),
          subagents: {
            resume: (hold, outcomes) => resumeSubagent(parent, hold, outcomes),
            run: (call) => runQueuedSubagent(parent, call),
            idOf: (toolCallId) => subagentId(conversationId, toolCallId),
          },
        },
        check.pause,
        check.outcomes,
        emit,
      );
      // Stopped before they were resumed: never resumed now, their states are worth nothing.
      for (const agentId of letGo) await conversations.letGoSubagent(conversationId, agentId);
      if (waiting.length > 0) {
        // A call queued behind must be asked about in its turn: the turn pauses again.
        const ticket = (await tickets()).signTicket({
          messageId: options.messageId,
          calls: waiting.map((call) => call.toolCallId),
        });
        await conversations.recordAnswers(conversationId, {
          outcomes: check.outcomes,
          results,
          pending: { calls: waiting, ticket, ...(holds.length > 0 ? { subagents: holds } : {}) },
        });
        const paused: TurnResult = {
          usage: { inputTokens: 0, outputTokens: 0 },
          suspended: { pending: waiting, ticket, ...(holds.length > 0 ? { subagents: holds } : {}) },
        };
        await tellTurnEnd(conversationId, paused);
        return paused;
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
    recommendedModels: recommended,
    downloadModel,
    doctor: () =>
      runDoctor({
        nodeVersion: process.version,
        llama: async () => {
          const llama = await llamaFound();
          return llama ? { source: llama.source, command: llama.path, build: llama.build } : null;
        },
        slotsDir: kvDir,
        canWrite: async (dir) => {
          try {
            await mkdir(dir, { recursive: true });
            const probe = join(dir, `.bp-write-probe-${process.pid}`);
            await writeFile(probe, '');
            await rm(probe, { force: true });
            return true;
          } catch {
            return false;
          }
        },
        freeDiskBytes: async (dir) =>
          statfs(dir).then(
            (disk) => disk.bavail * disk.bsize,
            () => null,
          ),
        gpuBytes,
      }),
  };
  return core;
}

/** A load names a file the core did not list: the window may only load what it was shown. */
/** A reply runs: the engine is not changed under it (task 7.4). */
export class EngineBusyError extends Error {
  constructor() {
    super('A reply is running: the model is not changed under it.');
    this.name = 'EngineBusyError';
  }
}

export class ModelNotListedError extends Error {
  constructor(readonly path: string) {
    super(`This file is not among the models bonaparte found: ${path}`);
    this.name = 'ModelNotListedError';
  }
}

function nameOf(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.gguf$/i, '');
}
