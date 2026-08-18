/**
 * Contrat des backends de modèle — LE point d'extension : llama.cpp est le
 * backend inclus d'office, un plugin peut en enregistrer d'autres. L'UI et le
 * kv-store dégradent selon les capacités déclarées.
 */

export interface BackendCapabilities {
  /** Sauvegarde/restauration d'état par conversation (slots). */
  kvPersistence: boolean;
  /** Sortie contrainte par grammaire (GBNF / json_schema). */
  grammar: boolean;
}

export type BackendStatus =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'crashed'
  | 'restarting';

export interface SamplingParams {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  seed?: number;
  stop?: string[];
}

export interface CompletionRequest {
  /** Prompt DÉJÀ templaté côté client, octet-identique entre tours. */
  prompt: string;
  idSlot?: number;
  cachePrompt?: boolean;
  returnProgress?: boolean;
  nPredict?: number;
  /** Grammaire GBNF brute (exclusif avec jsonSchema). */
  grammar?: string;
  jsonSchema?: object;
  /**
   * Grammaire paresseuse : ne s'applique qu'après un déclencheur. Paramètres
   * non documentés dans le README de llama.cpp, vérifiés dans
   * tools/server/server-schema.cpp.
   */
  grammarLazy?: boolean;
  grammarTriggers?: { type: number; value: string }[];
  /** Mots déclencheurs mono-token à ne pas fragmenter à la tokenisation. */
  preservedTokens?: string[];
  sampling?: SamplingParams;
  signal?: AbortSignal;
}

export interface PromptProgress {
  total: number;
  cache: number;
  processed: number;
  timeMs: number;
}

export interface CompletionStats {
  promptMs: number;
  promptUncachedTokens: number;
  predictedTokens: number;
  predictedMs: number;
  progress?: PromptProgress;
}

export type CompletionEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; stats: CompletionStats };

export interface SlotSaveResult {
  idSlot: number;
  filename: string;
  nSaved: number;
  nWritten: number;
  saveMs: number;
}

export interface SlotRestoreResult {
  idSlot: number;
  filename: string;
  nRestored: number;
  nRead: number;
  restoreMs: number;
}

export interface SlotApi {
  save(idSlot: number, filename: string): Promise<SlotSaveResult>;
  restore(idSlot: number, filename: string): Promise<SlotRestoreResult>;
  erase(idSlot: number): Promise<number>;
}

export interface ServerProps {
  modelPath: string;
  totalSlots: number;
  chatTemplate: string;
}

export interface Backend {
  /** Identifiant d'instance (ex. 'llamacpp:local'). */
  id: string;
  /** Type enregistré dans le registre (ex. 'llamacpp'). */
  typeId: string;
  capabilities: BackendCapabilities;
  status(): BackendStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  complete(request: CompletionRequest): AsyncIterable<CompletionEvent>;
  props(): Promise<ServerProps>;
  /** Présent si et seulement si capabilities.kvPersistence. */
  slots?: SlotApi;
  onStatusChange(listener: (status: BackendStatus) => void): () => void;
}
