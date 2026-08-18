/**
 * @aparte/bonaparte-shared — types et schémas partagés entre le harness
 * (@aparte/bonaparte-core), l'app Electron et les plugins.
 *
 * Zéro dépendance workspace : ce paquet est une feuille du graphe.
 */

/** Locales supportées par bonaparte (UI et messages du harness). */
export type BonaparteLocale = 'fr' | 'en';

export const BONAPARTE_LOCALES: readonly BonaparteLocale[] = ['fr', 'en'];

/**
 * Canaux IPC main↔renderer. Un seul endroit fait autorité : le preload et le
 * main importent ces constantes, jamais de littéraux en double.
 */
export const IPC = {
  appVersion: 'app.version',
  configGet: 'config.get',
  configSet: 'config.set',
  backendStart: 'backend.start',
  backendStatus: 'backend.status',
  conversationOpen: 'conversation.open',
  agentSend: 'agent.send',
  kvSave: 'kv.save',
  setupSuggest: 'setup.suggest',
  dialogPickFile: 'dialog.pickFile',
  modelsScan: 'models.scan',
  endpointModels: 'models.endpoint',
  openExternal: 'shell.openExternal',
  projectOpen: 'project.open',
  projectCurrent: 'project.current',
  modeGet: 'mode.get',
  modeSet: 'mode.set',
  approvalRespond: 'approval.respond',
  evApproval: 'ev.approval',
  /** Événements poussés main → renderer. */
  evAgent: 'ev.agent',
  evBackendStatus: 'ev.backendStatus',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/**
 * Config du MOTEUR llama.cpp (persistée dans global.json). Le modèle n'en
 * fait pas partie : c'est une propriété de chaque conversation, choisie
 * depuis l'inventaire.
 */
export type BackendConfigDto =
  | { mode: 'remote'; url: string }
  | {
      mode: 'managed';
      binPath: string;
      nGpuLayers?: number;
    }
  /**
   * Endpoint OpenAI-compatible : LM Studio, Ollama, vLLM… et le cloud avec une
   * clé. Pas de persistance de contexte (l'UI le signale honnêtement) ; le
   * modèle est celui que sert l'endpoint.
   */
  | {
      mode: 'openai-compat';
      baseUrl: string;
      model: string;
      apiKey?: string;
    };

/** Modèle découvert par l'inventaire (scan des emplacements connus). */
export interface ModelInfoDto {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: 'lmstudio' | 'hf-cache' | 'custom' | 'manual';
}

export interface AppConfigDto {
  backend?: BackendConfigDto;
  /** Modèle par défaut des nouvelles conversations (réglable dans Réglages). */
  defaultModel?: {
    path: string;
    nCtx?: number;
  };
  /** Dernier projet ouvert, et l'historique récent. */
  projectRoot?: string;
  recentProjects?: string[];
  mode?: PlayModeDto;
  /** Langue de l'utilisateur — pilote l'UI ET la langue de réponse du modèle. */
  locale?: BonaparteLocale;
}

/** Modes de jeu (lexique théâtre) — cf. moteur de permissions. */
export type PlayModeDto = 'lecture' | 'repetition' | 'plume' | 'impro';

export interface ProjectDto {
  root: string;
  name: string;
  recents: string[];
}

/** Demande d'autorisation poussée au renderer pendant la boucle. */
export interface ApprovalRequestDto {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
}

export interface ApprovalResponseDto {
  id: string;
  granted: boolean;
  /** Mémoriser la règle pour ce projet (« toujours autoriser »). */
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

/** Événement de flux agent, sérialisé sur l'IPC. */
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
  /** Modèle épinglé à la conversation. */
  modelPath?: string;
  modelName?: string;
}

/** L'ouverture exige un choix de modèle (nouvelle conversation en managé). */
export interface NeedsModelDto {
  needsModel: true;
  conversationId: string;
}

/** L'ouverture exige un projet : un agent de code travaille sur un dossier. */
export interface NeedsProjectDto {
  needsProject: true;
}

export type ConversationOpenReplyDto =
  | ConversationOpenResultDto
  | NeedsModelDto
  | NeedsProjectDto;

/** Pré-remplissage du panneau de configuration (détection machine). */
export interface SetupSuggestionDto {
  binPath?: string;
}

export type PickFileKind = 'binary' | 'gguf';

/**
 * Contrat du pont preload → renderer (window.bonaparte). Le preload
 * l'implémente, le renderer le consomme — jamais d'ipcRenderer brut exposé.
 */
export interface BonaparteBridge {
  suggestSetup(): Promise<SetupSuggestionDto>;
  pickFile(kind: PickFileKind): Promise<string | null>;
  scanModels(): Promise<ModelInfoDto[]>;
  /** Modèles servis par un endpoint OpenAI-compatible (GET /models). */
  listEndpointModels(baseUrl: string, apiKey?: string): Promise<string[]>;
  /** N'ouvre que des URLs https d'une liste blanche (main process). */
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  setConfig(config: AppConfigDto): Promise<void>;
  getBackendStatus(): Promise<BackendStatusDto>;
  startBackend(config: BackendConfigDto): Promise<BackendStatusDto>;
  openConversation(
    id?: string,
    modelPath?: string,
    nCtx?: number,
  ): Promise<ConversationOpenReplyDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;

  /** Ouvre un dossier de projet (dialogue natif) ; null si annulé. */
  openProject(): Promise<ProjectDto | null>;
  currentProject(): Promise<ProjectDto | null>;
  getMode(): Promise<PlayModeDto>;
  setMode(mode: PlayModeDto): Promise<void>;
  respondToApproval(response: ApprovalResponseDto): Promise<void>;
  onApprovalRequest(
    listener: (request: ApprovalRequestDto) => void,
  ): () => void;
}
