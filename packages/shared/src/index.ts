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
  /** Événements poussés main → renderer. */
  evAgent: 'ev.agent',
  evBackendStatus: 'ev.backendStatus',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Config d'un backend llama.cpp, telle que persistée dans global.json. */
export type BackendConfigDto =
  | { mode: 'remote'; url: string }
  | {
      mode: 'managed';
      binPath: string;
      modelPath: string;
      nCtx?: number;
      nGpuLayers?: number;
    };

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
}

/**
 * Contrat du pont preload → renderer (window.bonaparte). Le preload
 * l'implémente, le renderer le consomme — jamais d'ipcRenderer brut exposé.
 */
export interface BonaparteBridge {
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  setConfig(config: AppConfigDto): Promise<void>;
  getBackendStatus(): Promise<BackendStatusDto>;
  startBackend(config: BackendConfigDto): Promise<BackendStatusDto>;
  openConversation(id?: string): Promise<ConversationOpenResultDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;
}
