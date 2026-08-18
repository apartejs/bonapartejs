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

// ── Contrat de tour, agnostique du fournisseur ─────────────────────────
//
// La boucle agentique ne connaît QUE ces types : un transcript sémantique
// entre et des événements structurés sortent. Comment une conversation
// devient une requête — prompt brut templaté pour llama.cpp, `messages[]`
// pour une API cloud — est l'affaire du backend, pas de la boucle.

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  content: string;
}

export type TranscriptEntry =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      thinking?: string;
      calls?: ToolCall[];
      /**
       * Sortie VERBATIM du fournisseur pour ce tour. Indispensable aux
       * backends à préfixe stable : au rejeu, reconstituer le texte depuis
       * `text`/`calls` donnerait un octet près mais pas identique, et le
       * cache KV sauterait. Les autres fournisseurs l'ignorent.
       */
      raw?: string;
    }
  | { role: 'tool_results'; results: ToolOutcome[] }
  /** Message de service (delta d'inventaire d'outils). */
  | { role: 'service'; text: string };

export interface SystemSpec {
  projectRoot: string;
  replyLanguage?: string;
  projectInstructions?: string;
}

export interface TurnRequest {
  conversationId: string;
  system: SystemSpec;
  /** Inventaire d'outils de CE tour (grammaire ou API native selon le backend). */
  tools: ToolDefLike[];
  transcript: TranscriptEntry[];
  signal: AbortSignal;
  idSlot?: number;
}

/** Forme minimale d'un outil attendue par un backend (cf. tools/types.ts). */
export interface ToolDefLike {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Événements d'un tour. Les noms suivent volontairement `AparteStreamEvent`
 * d'apartéJS (text / thinking / tool_use / done) : le jour où les providers
 * de la lib seront importables depuis Node, l'un d'eux deviendra un backend
 * bonaparte sans traduction — un appel d'outil par événement, la boucle les
 * regroupe jusqu'au `done`.
 */
export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; call: ToolCall }
  | { type: 'done'; stats: CompletionStats; raw?: string };

export interface Backend {
  /** Identifiant d'instance (ex. 'llamacpp:local'). */
  id: string;
  /** Type enregistré dans le registre (ex. 'llamacpp'). */
  typeId: string;
  capabilities: BackendCapabilities;
  status(): BackendStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** LE point d'entrée de la boucle agentique. */
  runTurn(request: TurnRequest): AsyncIterable<ProviderEvent>;
  /**
   * État opaque à persister par conversation (llama.cpp y met son prompt
   * système figé). Absent = le backend n'a rien à retenir.
   */
  exportState?(conversationId: string): unknown;
  importState?(conversationId: string, state: unknown): void;
  /**
   * Prépare une conversation à son ouverture (llama.cpp y fige son prompt
   * système). Attendre le premier tour laisserait une fenêtre où l'inventaire
   * pourrait changer sans qu'aucun delta ne l'annonce.
   */
  prepareConversation?(
    conversationId: string,
    system: SystemSpec,
    tools: ToolDefLike[],
  ): void;
  /** Primitive bas niveau — utile aux backends à complétion brute. */
  complete(request: CompletionRequest): AsyncIterable<CompletionEvent>;
  props(): Promise<ServerProps>;
  /** Présent si et seulement si capabilities.kvPersistence. */
  slots?: SlotApi;
  onStatusChange(listener: (status: BackendStatus) => void): () => void;
}
