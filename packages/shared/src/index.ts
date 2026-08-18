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
  openExternal: 'shell.openExternal',
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
      nCtx?: number;
      nGpuLayers?: number;
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

export type ConversationOpenReplyDto = ConversationOpenResultDto | NeedsModelDto;

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
  /** N'ouvre que des URLs https d'une liste blanche (main process). */
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  setConfig(config: AppConfigDto): Promise<void>;
  getBackendStatus(): Promise<BackendStatusDto>;
  startBackend(config: BackendConfigDto): Promise<BackendStatusDto>;
  openConversation(id?: string, modelPath?: string): Promise<ConversationOpenReplyDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;
}
