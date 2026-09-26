/**
 * @aparte/bonaparte-shared — types and schemas shared between the harness
 * (@aparte/bonaparte-core), the Electron app and the plugins.
 *
 * Zero workspace dependency: this package is a leaf of the graph.
 */

/** Plugin contract: declarative manifest and statuses. */
export * from './plugins.js';
// An `export *` puts nothing in local scope: the bridge contract, further
// down, needs the type itself.
import type { LocalizedText, PluginStatusDto } from './plugins.js';

export * from './locale.js';
import type { BonaparteLocale } from './locale.js';

/**
 * main↔renderer IPC channels. A single place has authority: the preload and
 * the main import these constants, never duplicate literals.
 */
export const IPC = {
  appVersion: 'app.version',
  configGet: 'config.get',
  configSetDefaultModel: 'config.setDefaultModel',
  configSetLocale: 'config.setLocale',
  backendStart: 'backend.start',
  backendRegister: 'backend.register',
  conversationHistory: 'conversation.history',
  backendStatus: 'backend.status',
  conversationOpen: 'conversation.open',
  conversationList: 'conversation.list',
  conversationCreate: 'conversation.create',
  conversationRename: 'conversation.rename',
  conversationDelete: 'conversation.delete',
  agentSend: 'agent.send',
  agentInFlight: 'agent.inFlight',
  agentCancel: 'agent.cancel',
  kvSave: 'kv.save',
  setupSuggest: 'setup.suggest',
  dialogPickFile: 'dialog.pickFile',
  modelsScan: 'models.scan',
  endpointProbe: 'endpoint.probe',
  modelsEstimateSwitch: 'models.estimateSwitch',
  openExternal: 'shell.openExternal',
  projectOpen: 'project.open',
  projectCurrent: 'project.current',
  projectsList: 'projects.list',
  projectCreate: 'projects.create',
  projectRename: 'projects.rename',
  projectSetRoots: 'projects.setRoots',
  projectRemove: 'projects.remove',
  dialogPickDirectory: 'dialog.pickDirectory',
  conversationSetProject: 'conversation.setProject',
  modeGet: 'mode.get',
  modeSet: 'mode.set',
  approvalRespond: 'approval.respond',
  pluginsList: 'plugins.list',
  pluginsInvoke: 'plugins.invoke',
  pluginsReload: 'plugins.reload',
  pluginsAck: 'plugins.ack',
  settingsGet: 'settings.get',
  settingsSet: 'settings.set',
  grantsList: 'grants.list',
  grantsRevoke: 'grants.revoke',
  evApproval: 'ev.approval',
  /** Events pushed main → renderer. */
  evAgent: 'ev.agent',
  evPlugin: 'ev.plugin',
  evBackendStatus: 'ev.backendStatus',
  evResources: 'ev.resources',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/**
 * llama.cpp ENGINE config (persisted in global.json). The model is not part
 * of it: it's a property of each conversation, chosen from the inventory.
 */
export type BackendConfigDto =
  | { mode: 'remote'; url: string }
  | {
      mode: 'managed';
      binPath: string;
      nGpuLayers?: number;
    };

/**
 * What a URL turned out to be. A single protocol: bonaparte only drives
 * llama.cpp, the only one to offer the context persistence that justifies
 * the product. `remote` is not another provider — it's the same server,
 * simply not launched by us.
 */
export interface EndpointProbeDto {
  protocol: 'llamacpp';
  baseUrl: string;
  model?: string;
  totalSlots?: number;
}

/** How a model's memory need compares with the machine's memory. */
export type MemoryVerdictDto = 'fits' | 'tight' | 'too-big' | 'unknown';

/** What a model will take in memory at the engine's context size and cache type. */
export interface ModelMemoryDto {
  totalBytes: number;
  weightsBytes: number;
  kvBytes: number;
  /** The context size the estimate is for (the engine's). */
  nCtx: number;
  verdict: MemoryVerdictDto;
  /** The context is larger than the one the model was trained for. */
  beyondTraining: boolean;
}

/** Model discovered by the inventory (scan of known locations). */
export interface ModelInfoDto {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: 'lmstudio' | 'hf-cache' | 'custom' | 'manual';
  /** Absent when the GGUF header could not be read. */
  memory?: ModelMemoryDto;
}

/** What switching a conversation to another model costs — shown before the switch (D-03, P1.7). */
export interface SwitchEstimateDto {
  modelPath: string;
  modelName: string;
  memory: ModelMemoryDto;
  /** The machine's memory, the verdict's denominator. */
  machineBytes: number;
  /** Bytes read from disk to load the model. */
  readBytes: number;
  /** Seconds this model took to load last time, when measured. */
  loadSeconds?: number;
  /** Tokens of the conversation computed again on the new model. */
  reprefillTokens: number;
  /** Seconds for that, when this model's prefill speed was measured. */
  reprefillSeconds?: number;
}

export interface AppConfigDto {
  backend?: BackendConfigDto;
  /** Default model for new conversations (configurable in Settings). */
  defaultModel?: {
    path: string;
    nCtx?: number;
  };
  /**
   * History of recent folders — of the app, not of a conversation. The
   * project itself belongs to the open conversation: it must be possible to
   * chat without a folder, and hold two conversations on two folders.
   */
  recentProjects?: string[];
  /** Last open conversation, reopened on the next startup. */
  currentConversationId?: string;
  mode?: PlayModeDto;
  /** Global settings (sampling + launch), resolved in layers. */
  settings?: Record<string, unknown>;
  /** User's language — drives the UI AND the model's reply language. */
  locale?: BonaparteLocale;
}

/** Play modes (theater vocabulary) — see the permissions engine. */
export type PlayModeDto = 'lecture' | 'repetition' | 'plume' | 'impro';

export interface ProjectDto {
  root: string;
  name: string;
  recents: string[];
}

/**
 * A project: a NAMED entity carrying an ORDERED set of roots.
 *
 * The project defines what the model can SEE; the conversation defines how
 * a turn executes. The first root is the default for relative paths — so
 * the order carries meaning, it isn't cosmetic.
 */
export interface ProjectSummaryDto {
  id: string;
  name: string;
  roots: string[];
}

/** A conversation in the menu list — enough to display and pick it. */
export interface ConversationSummaryDto {
  id: string;
  title: string;
  updatedAt: string;
  /** Attached project — absent = "no project", a valid case. */
  projectId?: string;
  /** Project name, if the conversation has one. */
  projectName?: string;
  /** Pinned model, if there is one. */
  modelName?: string;
  /** A KV state exists on disk: resuming will be instant. */
  hasKvState: boolean;
}

/** How the side menu is organized — preference persisted globally. */
export type SidebarGroupingDto = 'project' | 'flat';
export type SidebarSortDto = 'updated' | 'title';

/** A resolved setting, as the UI displays it: value AND provenance. */
export interface ResolvedSettingDto {
  key: string;
  /** UI string, both locales: the component resolves the current one. */
  label: LocalizedText;
  type: 'string' | 'number' | 'boolean' | 'select';
  description?: LocalizedText;
  options?: { value: string; label: LocalizedText }[];
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
  /** A field that reads as a secret (an API key): shown masked, one line. */
  secret?: boolean;
  /** Shown only when the listed sibling settings hold one of the given values. */
  showFor?: Record<string, string[]>;
  value: unknown;
  /** Layer that provides the value: 'default' | 'global' | 'conversation'. */
  from: string;
  /** Does the displayed scope explicitly override this setting? */
  overridden: boolean;
  /** Changing this setting invalidates saved KV states. */
  invalidatesKv: boolean;
}

export type SettingScopeDto = 'global' | 'conversation';

/** A standing "always allow", as the hub lists it. */
export interface GrantDto {
  /** Absent: granted in a conversation without a project. */
  projectId?: string;
  projectName?: string;
  tool: string;
  /** Every command of this program. */
  commandPrefix?: string;
  /** This exact command line. */
  exactCommand?: string;
}

/** Approval request pushed to the renderer during the loop. */
export interface ApprovalRequestDto {
  id: string;
  /** The conversation whose turn is waiting: the question is asked there, and there only. */
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
  /**
   * The program the command runs, when it is a plain name an "always" can
   * safely cover (`git`, `pnpm`) — absent otherwise, and then only the
   * exact line can be remembered.
   */
  binary?: string;
}

/** What an "always allow" covers: this exact command, or every command of its program. */
export type AlwaysScopeDto = 'command' | 'binary';

export interface ApprovalResponseDto {
  id: string;
  granted: boolean;
  /** Remember the grant for this project ("always allow"), with its scope. */
  always?: AlwaysScopeDto;
}

export type BackendStatusDto =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'crashed'
  | 'restarting';

export interface PromptProgressDto {
  total: number;
  cache: number;
  processed: number;
  timeMs: number;
}

export interface CompletionStatsDto {
  promptMs: number;
  promptUncachedTokens: number;
  predictedTokens: number;
  predictedMs: number;
  progress?: PromptProgressDto;
  /** Tokens the slot holds after the turn — prompt and reply — the gauge's numerator. */
  contextTokens?: number;
  /** The server cut the reply at the context ceiling: it is incomplete, not finished. */
  truncated?: boolean;
}

/** Agent stream event, serialized over the IPC. */
/** What a turn produces, without the conversation it belongs to. */
export type AgentEventBodyDto =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'done'; stats: CompletionStatsDto }
  | { type: 'error'; message: string }
  /**
   * The conversation has no usable model: the renderer offers the picker
   * instead of printing an error. `missingModel` names the pinned file when
   * it has vanished from disk.
   */
  | { type: 'needs_model'; missingModel?: string }
  /** The message cannot fit in the server's context, with room for a reply (D-22). */
  | { type: 'context_overflow'; used: number; nCtx: number; limit: number; needed: number };

/**
 * Every event names its conversation: a reply keeps streaming while the
 * user reads another conversation, and the screen showing that other one
 * must ignore it — not paint it into the wrong thread.
 */
export type AgentEventDto = { conversationId: string } & AgentEventBodyDto;

/** The turn in flight, as far as it got — for a screen that comes back mid-stream. */
export interface InFlightDto {
  conversationId: string;
  text: string;
  thinking: string;
}

/** One piece of an assistant turn, as it was seen live. */
export type ConversationSegmentDto =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; args: Record<string, unknown>; ok?: boolean; content?: string };

export interface ConversationEventDto {
  type: 'user' | 'assistant';
  text: string;
  at: string;
  /** An assistant turn, segment by segment — reasoning, tool calls with their outcome, text. */
  segments?: ConversationSegmentDto[];
}

export type RestoreDto =
  | { restored: true; nRestored: number }
  | { restored: false; reason: string };

/** What the shared prefix did at open, when nothing of the conversation's own was restored. */
export interface SeedDto {
  /** true: an existing seed was restored; false: the prefix was prepared for the next conversation. */
  restored: boolean;
  tokens: number;
}

export interface ConversationOpenResultDto {
  conversationId: string;
  events: ConversationEventDto[];
  restore: RestoreDto;
  seed?: SeedDto;
  /** Model pinned to the conversation. */
  modelPath?: string;
  modelName?: string;
  /** Context size of the conversation — denominator of the gauge. */
  nCtx?: number;
  /** Tokens already in the slot at open (a restored state) — the gauge's numerator until the first turn. */
  contextTokens?: number;
  /**
   * Pinned model whose file is no longer on disk (managed mode). Announced
   * at open, so the user learns it before typing, not after a failed launch.
   */
  missingModel?: string;
}

/** What the machine is doing, sampled every few seconds (see core's ResourceMonitor). */
export interface ResourceSampleDto {
  at: number;
  /** 0–100 over every core; null until two readings exist. */
  cpu: number | null;
  memory: { usedBytes: number; totalBytes: number };
  gpu: { dedicatedBytes: number; sharedBytes: number; utilization: number | null } | null;
  server: { pid: number; workingSetBytes: number; cpu: number | null } | null;
  app: { workingSetBytes: number; cpu: number | null } | null;
}

/** Opening requires a model choice (new conversation in managed mode). */
export interface NeedsModelDto {
  needsModel: true;
  conversationId: string;
  /** Model pinned to the conversation (or default) whose file is gone. */
  missingModel?: string;
}

export type ConversationOpenReplyDto = ConversationOpenResultDto | NeedsModelDto;

/** Pre-fill for the configuration panel (machine detection). */
export interface SetupSuggestionDto {
  binPath?: string;
}

export type PickFileKind = 'binary' | 'gguf';

/**
 * Contract of the preload → renderer bridge (window.bonaparte). The preload
 * implements it, the renderer consumes it — never a raw ipcRenderer exposed.
 */
export interface BonaparteBridge {
  suggestSetup(): Promise<SetupSuggestionDto>;
  pickFile(kind: PickFileKind): Promise<string | null>;
  scanModels(): Promise<ModelInfoDto[]>;
  /** What switching this conversation to that model would cost; null when the model cannot be read. */
  estimateSwitch(conversationId: string, modelPath: string): Promise<SwitchEstimateDto | null>;
  /** Checks that a llama-server does respond at this URL (remote mode). */
  probeEndpoint(url: string): Promise<EndpointProbeDto | null>;
  /** Only opens https URLs from an allowlist (main process). */
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  /**
   * The config is written by narrow operations only — never whole: a
   * whole-config write let one screen erase what another had saved (the
   * model picker wrote `{ backend, defaultModel }` and dropped the rest),
   * and let the renderer write anything the engine would later read. The
   * engine config is saved by `startBackend` itself, once it works.
   */
  setDefaultModel(modelPath: string): Promise<void>;
  setLocale(locale: BonaparteLocale): Promise<void>;
  getBackendStatus(): Promise<BackendStatusDto>;
  startBackend(config: BackendConfigDto): Promise<BackendStatusDto>;
  /** Registers the engine without connecting to it (cold start). */
  registerBackend(config: BackendConfigDto): Promise<void>;
  /**
   * History of a conversation, WITHOUT waking the engine. This is the path
   * for viewing and switching: reading never needs the KV cache, which only
   * serves the next generation.
   */
  conversationHistory(select?: string): Promise<ConversationOpenReplyDto>;
  /** All conversations, the most recently touched one first. */
  listConversations(): Promise<ConversationSummaryDto[]>;
  /**
   * Creates a conversation and returns its id. The project is optional:
   * chatting without a folder is normal usage, not a degraded state.
   */
  createConversation(projectRoot?: string): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  /**
   * Erases a conversation for good — its log, its meta, its saved KV
   * state. A turn in flight there is cut first.
   */
  deleteConversation(id: string): Promise<void>;
  /** Discovered plugins, with their views and any errors. */
  listPlugins(): Promise<PluginStatusDto[]>;
  /**
   * Unmounts then re-activates all plugins, without restarting the app —
   * so without reloading the model. Returns the up-to-date inventory.
   */
  reloadPlugins(): Promise<PluginStatusDto[]>;
  /**
   * Subscribes to events PUSHED by a plugin's Node half.
   *
   * The view must acknowledge what it has consumed (`ackPluginData`):
   * without acknowledgment, the host pauses the producer at the high
   * threshold and it never resumes. That's the price of losing nothing.
   */
  onPluginEvent(
    listener: (e: {
      pluginId: string;
      /** Targeted view instance — empty string for a single-view plugin. */
      instanceId: string;
      event: string;
      payload: unknown;
    }) => void,
  ): () => void;
  /**
   * Declares `bytes` bytes consumed by ONE instance, to let it resume.
   * The other tabs are not affected.
   */
  ackPluginData(pluginId: string, instanceId: string, bytes: number): void;
  /** Calls a command on a plugin's Node half, from its view. */
  invokePlugin(pluginId: string, command: string, payload?: unknown): Promise<unknown>;
  /** Settings for a scope, resolved values including provenance. */
  getSettings(scope: SettingScopeDto): Promise<ResolvedSettingDto[]>;
  /** Sets an override; `undefined` removes it and restores inheritance. */
  setSetting(scope: SettingScopeDto, key: string, value: unknown): Promise<void>;
  openConversation(id?: string, modelPath?: string): Promise<ConversationOpenReplyDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  /** The turn streaming right now, if any — to catch up on when a screen mounts. */
  inFlight(): Promise<InFlightDto | null>;
  /** Cuts the turn in flight of the current conversation; what arrived stays. */
  cancelMessage(): Promise<void>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;
  onResources(listener: (sample: ResourceSampleDto) => void): () => void;

  /** Opens a project folder (native dialog); null if canceled. */
  openProject(): Promise<ProjectDto | null>;
  currentProject(): Promise<ProjectDto | null>;

  /** All projects, to group the menu and offer a move. */
  listProjects(): Promise<ProjectSummaryDto[]>;
  createProject(name: string, roots?: string[]): Promise<ProjectSummaryDto>;
  renameProject(id: string, name: string): Promise<ProjectSummaryDto>;
  /** Replaces the roots WHILE KEEPING the given order (it is meaningful). */
  setProjectRoots(id: string, roots: string[]): Promise<ProjectSummaryDto>;
  removeProject(id: string): Promise<void>;
  /** Folder picker, with no side effect: just returns the chosen path. */
  pickDirectory(): Promise<string | null>;
  /** Attaches a conversation to a project, or detaches it with `null`. */
  setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): Promise<void>;
  /** Every standing "always allow", with its project. */
  listGrants(): Promise<GrantDto[]>;
  /** Takes one back: the next such call asks again. */
  revokeGrant(grant: GrantDto): Promise<void>;
  getMode(): Promise<PlayModeDto>;
  setMode(mode: PlayModeDto): Promise<void>;
  respondToApproval(response: ApprovalResponseDto): Promise<void>;
  onApprovalRequest(
    listener: (request: ApprovalRequestDto) => void,
  ): () => void;
}
