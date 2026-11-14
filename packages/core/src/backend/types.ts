/**
 * What the core says to a llama.cpp server, and hears back: a completion
 * request and its stream of events, the slot actions that save and restore a
 * KV state, and the properties the server reports.
 */

export interface BackendCapabilities {
  /** Save/restore state per conversation (slots). */
  kvPersistence: boolean;
  /** Output constrained by grammar (GBNF / json_schema). */
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
  /** Prompt ALREADY templated client-side, byte-identical across turns. */
  prompt: string;
  idSlot?: number;
  cachePrompt?: boolean;
  returnProgress?: boolean;
  nPredict?: number;
  /** Raw GBNF grammar (exclusive with jsonSchema). */
  grammar?: string;
  jsonSchema?: object;
  /**
   * Lazy grammar: only applies after a trigger. Parameters not documented
   * in llama.cpp's README, verified in tools/server/server-schema.cpp.
   */
  grammarLazy?: boolean;
  grammarTriggers?: { type: number; value: string }[];
  /** Single-token trigger words that must not be split at tokenization. */
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
  /**
   * Tokens the slot holds after the turn — prompt AND reply
   * (llama-server's `tokens_cached`). What the context gauge should show,
   * and what the next message adds to.
   */
  contextTokens?: number;
  /**
   * The server cut the generation because the context filled up
   * (`--no-context-shift`): the reply is incomplete, not finished. Surfaced
   * so the truncation is explained instead of a silently short answer.
   */
  truncated?: boolean;
}

export type CompletionEvent =
  | { type: 'token'; text: string }
  /** The prompt is being read: how far, as the server reports after each batch. */
  | { type: 'progress'; progress: PromptProgress }
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
  /** The context one slot really has (`-c` is shared between the slots); 0 when the server does not say. */
  nCtx: number;
  chatTemplate: string;
}
