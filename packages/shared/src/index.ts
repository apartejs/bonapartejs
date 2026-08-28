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
  configSet: 'config.set',
  backendStart: 'backend.start',
  backendRegister: 'backend.register',
  conversationHistory: 'conversation.history',
  backendStatus: 'backend.status',
  conversationOpen: 'conversation.open',
  conversationList: 'conversation.list',
  conversationCreate: 'conversation.create',
  conversationRename: 'conversation.rename',
  agentSend: 'agent.send',
  kvSave: 'kv.save',
  setupSuggest: 'setup.suggest',
  dialogPickFile: 'dialog.pickFile',
  modelsScan: 'models.scan',
  endpointProbe: 'endpoint.probe',
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
  evApproval: 'ev.approval',
  /** Events pushed main → renderer. */
  evAgent: 'ev.agent',
  evPlugin: 'ev.plugin',
  evBackendStatus: 'ev.backendStatus',
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

/** Model discovered by the inventory (scan of known locations). */
export interface ModelInfoDto {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: 'lmstudio' | 'hf-cache' | 'custom' | 'manual';
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
  value: unknown;
  /** Layer that provides the value: 'default' | 'global' | 'conversation'. */
  from: string;
  /** Does the displayed scope explicitly override this setting? */
  overridden: boolean;
  /** Changing this setting invalidates saved KV states. */
  invalidatesKv: boolean;
}

export type SettingScopeDto = 'global' | 'conversation';

/** Approval request pushed to the renderer during the loop. */
export interface ApprovalRequestDto {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
}

export interface ApprovalResponseDto {
  id: string;
  granted: boolean;
  /** Remember the rule for this project ("always allow"). */
  always?: boolean;
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
}

/** Agent stream event, serialized over the IPC. */
export type AgentEventDto =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'done'; stats: CompletionStatsDto }
  | { type: 'error'; message: string };

export interface ConversationEventDto {
  type: 'user' | 'assistant';
  text: string;
  at: string;
}

export type RestoreDto =
  | { restored: true; nRestored: number }
  | { restored: false; reason: string };

export interface ConversationOpenResultDto {
  conversationId: string;
  events: ConversationEventDto[];
  restore: RestoreDto;
  /** Model pinned to the conversation. */
  modelPath?: string;
  modelName?: string;
  /** Context size of the conversation — denominator of the gauge. */
  nCtx?: number;
}

/** Opening requires a model choice (new conversation in managed mode). */
export interface NeedsModelDto {
  needsModel: true;
  conversationId: string;
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
  /** Checks that a llama-server does respond at this URL (remote mode). */
  probeEndpoint(url: string): Promise<EndpointProbeDto | null>;
  /** Only opens https URLs from an allowlist (main process). */
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  setConfig(config: AppConfigDto): Promise<void>;
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
  openConversation(
    id?: string,
    modelPath?: string,
    nCtx?: number,
  ): Promise<ConversationOpenReplyDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;

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
  getMode(): Promise<PlayModeDto>;
  setMode(mode: PlayModeDto): Promise<void>;
  respondToApproval(response: ApprovalResponseDto): Promise<void>;
  onApprovalRequest(
    listener: (request: ApprovalRequestDto) => void,
  ): () => void;
}
