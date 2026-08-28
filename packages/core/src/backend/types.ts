/**
 * Model backend contract — THE extension point: llama.cpp is the backend
 * included by default, a plugin can register others. The UI and the
 * kv-store degrade gracefully based on the declared capabilities.
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

// ── Turn contract, provider-agnostic ────────────────────────────────────
//
// The agentic loop knows ONLY these types: a semantic transcript goes in
// and structured events come out. How a conversation becomes a request —
// a raw templated prompt for llama.cpp, `messages[]` for a cloud API — is
// the backend's business, not the loop's.

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
      /**
       * Whether the model was ALLOWED to reason for this turn — the choice
       * that shaped the generation suffix (bare header, or an empty think
       * block). Replay must render the same suffix, whatever the model then
       * chose to do, or the prefix breaks. Absent on older logs, which were
       * all generated with reasoning off.
       */
      reasoning?: boolean;
      calls?: ToolCall[];
      /**
       * VERBATIM provider output for this turn. Indispensable for
       * stable-prefix backends: on replay, reconstructing the text from
       * `text`/`calls` would land byte-close but not identical, and the
       * KV cache would drop. Other providers ignore it.
       */
      raw?: string;
    }
  | { role: 'tool_results'; results: ToolOutcome[] }
  /** Service message (tool inventory delta). */
  | { role: 'service'; text: string };

export interface SystemSpec {
  /**
   * Roots of the open project, ORDERED: the first is the default for
   * relative paths, the allowed scope is their union.
   *
   * Empty or absent = a project-less discussion. Tools still work, simply
   * without confinement — the project is their scope, not their condition
   * of existence. Opening a project later announces it via a delta.
   */
  roots?: string[];
  replyLanguage?: string;
  projectInstructions?: string;
}

export interface TurnRequest {
  conversationId: string;
  system: SystemSpec;
  /** Tool inventory for THIS turn (grammar or native API depending on the backend). */
  tools: ToolDefLike[];
  transcript: TranscriptEntry[];
  signal: AbortSignal;
  idSlot?: number;
  /**
   * Sampling for THIS turn (temperature & co). Adjustable per conversation:
   * unlike launch parameters, it changes nothing in the prompt's prefix, so
   * it invalidates no KV state.
   */
  sampling?: SamplingParams;
  /**
   * Whether the model may reason before answering (Qwen3 `<think>`).
   * Decided by the generation suffix of THIS turn only — the frozen history
   * is untouched, so toggling it costs nothing in the cache. Default: on.
   */
  thinking?: boolean;
}

/** Minimal shape of a tool expected by a backend (cf. tools/types.ts). */
export interface ToolDefLike {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Events of a turn. The names deliberately follow apartéJS's
 * `AparteStreamEvent` (text / thinking / tool_use / done): the day the
 * lib's providers become importable from Node, one of them will become a
 * bonaparte backend with no translation needed — one tool call per event,
 * the loop groups them until `done`.
 */
export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; call: ToolCall }
  | { type: 'done'; stats: CompletionStats; raw?: string };

export interface Backend {
  /** Instance identifier (e.g. 'llamacpp:local'). */
  id: string;
  /** Type registered in the registry (e.g. 'llamacpp'). */
  typeId: string;
  capabilities: BackendCapabilities;
  status(): BackendStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** THE entry point of the agentic loop. */
  runTurn(request: TurnRequest): AsyncIterable<ProviderEvent>;
  /**
   * Opaque state to persist per conversation (llama.cpp puts its frozen
   * system prompt there). Absent = the backend has nothing to remember.
   */
  exportState?(conversationId: string): unknown;
  importState?(conversationId: string, state: unknown): void;
  /**
   * Prepares a conversation when it opens (llama.cpp freezes its system
   * prompt there). Waiting for the first turn would leave a window where
   * the inventory could change with no delta announcing it.
   */
  prepareConversation?(
    conversationId: string,
    system: SystemSpec,
    tools: ToolDefLike[],
  ): void;
  /**
   * The rendered prefix every turn of this conversation starts with — the
   * frozen system block, byte for byte. Absent while nothing is frozen.
   * What a prefix seed is keyed on (see KvStore).
   */
  prefixText?(conversationId: string): string | undefined;
  /**
   * Prefills the prefix alone into a slot, generating nothing — `n_predict:
   * 0` on llama-server (verified on b10217: the slot holds exactly the
   * prefix afterwards; should a build sample one token there, the prefix
   * match of the next prompt drops it). Resolves with the tokens the slot
   * then holds, recorded with the seed.
   */
  prefill?(conversationId: string, idSlot: number): Promise<number>;
  /** Low-level primitive — useful for raw-completion backends. */
  complete(request: CompletionRequest): AsyncIterable<CompletionEvent>;
  props(): Promise<ServerProps>;
  /** Present if and only if capabilities.kvPersistence. */
  slots?: SlotApi;
  onStatusChange(listener: (status: BackendStatus) => void): () => void;
}
