/**
 * llama.cpp backend — the implementation included by default for the
 * Backend contract. Two modes: 'managed' (bonaparte spawns/supervises
 * llama-server, bounded restarts) and 'remote' (llama-server already
 * launched elsewhere, e.g. another machine).
 *
 * The spawn is injected (SpawnFn): supervision is tested with no real
 * binary, against the fake llama-server for the HTTP part.
 */

import { parseHermesOutput } from '../../wire/hermes-parser.js';
import { HermesStreamDemux } from '../../wire/stream-demux.js';
import { buildGrammarConstraint } from '../../tools/grammar.js';
import type {
  Backend,
  BackendStatus,
  CompletionRequest,
  CompletionStats,
  ProviderEvent,
  SlotApi,
  SystemSpec,
  ToolDefLike,
  TurnRequest,
} from '../types.js';
import { buildLlamaServerArgs, type LlamaCppLaunchConfig } from './args.js';
import { LlamaCppHttpClient } from './http-client.js';
import { TranscriptRenderer } from './turn-renderer.js';

export interface ProcessHandle {
  /** OS pid when the spawner knows it: recorded so an orphan can be killed at the next start. */
  pid?: number;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export type SpawnFn = (binPath: string, args: string[]) => ProcessHandle;

export interface ManagedOptions {
  mode: 'managed';
  binPath: string;
  launch: LlamaCppLaunchConfig;
  spawnFn: SpawnFn;
  /** Test seam: server URL if different from 127.0.0.1:port. */
  baseUrl?: string;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  maxRestarts?: number;
  /**
   * Subcommand to prefix the args with — ['serve'] for the unified
   * `llama` CLI, [] for the historical `llama-server` binary.
   * See detectServeCommandPrefix().
   */
  commandPrefix?: string[];
}

export interface RemoteOptions {
  mode: 'remote';
  url: string;
  /**
   * A remote server might not have --slot-save-path: the user declares
   * it. Runtime errors stay clean if that's wrong.
   */
  assumeKvPersistence?: boolean;
}

export type LlamaCppBackendOptions = ManagedOptions | RemoteOptions;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function slotApi(client: LlamaCppHttpClient): SlotApi {
  return {
    save: (idSlot, filename) => client.saveSlot(idSlot, filename),
    restore: (idSlot, filename) => client.restoreSlot(idSlot, filename),
    erase: (idSlot) => client.eraseSlot(idSlot),
  };
}

/** Persistable state of a conversation on the llama.cpp side. */
interface LlamaConversationState {
  systemPrompt: string;
}

abstract class BaseBackend implements Backend {
  /** One append-only renderer per conversation. */
  private readonly renderers = new Map<string, TranscriptRenderer>();

  private renderer(conversationId: string): TranscriptRenderer {
    let renderer = this.renderers.get(conversationId);
    if (!renderer) {
      renderer = new TranscriptRenderer();
      this.renderers.set(conversationId, renderer);
    }
    return renderer;
  }

  exportState(conversationId: string): unknown {
    const systemPrompt = this.renderers.get(conversationId)?.systemPrompt;
    return systemPrompt ? ({ systemPrompt } satisfies LlamaConversationState) : undefined;
  }

  prepareConversation(
    conversationId: string,
    system: SystemSpec,
    tools: ToolDefLike[],
  ): void {
    this.renderer(conversationId).ensureSystemPrompt(system, tools);
  }

  importState(conversationId: string, state: unknown): void {
    const systemPrompt = (state as LlamaConversationState | undefined)?.systemPrompt;
    if (typeof systemPrompt === 'string') {
      this.renderer(conversationId).restore(systemPrompt);
    }
  }

  prefixText(conversationId: string): string | undefined {
    const prefix = this.renderer(conversationId).prefix;
    return prefix === '' ? undefined : prefix;
  }

  /**
   * The prefix alone, into the slot: what the first turn of the
   * conversation would have prefilled anyway, done now so it can be saved
   * as a seed — and reused by every conversation that starts the same way.
   * Measured on Qwen3-1.7B (2026-08-28): 518 tokens, restored in 16 ms.
   */
  async prefill(conversationId: string, idSlot: number): Promise<number> {
    const prompt = this.renderer(conversationId).prefix;
    if (prompt === '') return 0;
    let held = 0;
    for await (const event of this.complete({ prompt, idSlot, cachePrompt: true, nPredict: 0 })) {
      if (event.type === 'done') {
        held = event.stats.contextTokens ?? event.stats.progress?.total ?? 0;
      }
    }
    return held;
  }

  /**
   * A turn: the transcript is rendered into an append-only prompt, the
   * grammar is regenerated from THIS turn's inventory, the output is
   * demuxed then parsed — everything specific to llama.cpp/Qwen stays
   * here.
   */
  async *runTurn(request: TurnRequest): AsyncIterable<ProviderEvent> {
    const renderer = this.renderer(request.conversationId);
    // Reasoning is the model's by default; the empty think block is only
    // forced when the conversation turned it off.
    const turn = renderer.next(request.transcript, request.system, request.tools, {
      thinking: request.thinking ?? true,
    });
    const constraint = buildGrammarConstraint(
      request.tools.map((t) => ({ ...t, effect: 'read' as const })),
    );

    const demux = new HermesStreamDemux();
    let stats: CompletionStats = {
      promptMs: 0,
      promptUncachedTokens: 0,
      predictedTokens: 0,
      predictedMs: 0,
    };

    try {
      for await (const event of this.complete({
        prompt: turn.prompt,
        idSlot: request.idSlot ?? 0,
        cachePrompt: true,
        returnProgress: true,
        signal: request.signal,
        ...(request.sampling ? { sampling: request.sampling } : {}),
        ...(constraint
          ? {
              grammar: constraint.grammar,
              grammarLazy: constraint.grammarLazy,
              grammarTriggers: constraint.grammarTriggers,
              preservedTokens: constraint.preservedTokens,
            }
          : {}),
      })) {
        if (event.type === 'token') {
          for (const out of demux.push(event.text)) {
            yield out.type === 'text'
              ? { type: 'text', delta: out.delta }
              : { type: 'thinking', delta: out.delta };
          }
        } else {
          stats = event.stats;
        }
      }
      for (const out of demux.flush()) {
        yield out.type === 'text'
          ? { type: 'text', delta: out.delta }
          : { type: 'thinking', delta: out.delta };
      }
    } finally {
      // The turn is frozen even on interruption: the prefix stays
      // consistent with what the server actually saw.
      turn.commit(demux.raw);
    }

    for (const call of parseHermesOutput(demux.raw).calls) {
      yield { type: 'tool_use', call: { name: call.name, arguments: call.arguments } };
    }
    yield { type: 'done', stats, raw: demux.raw };
  }

  abstract readonly id: string;
  readonly typeId = 'llamacpp';
  abstract readonly capabilities: Backend['capabilities'];
  slots?: SlotApi;

  protected currentStatus: BackendStatus = 'stopped';
  private readonly listeners = new Set<(status: BackendStatus) => void>();

  constructor(protected readonly client: LlamaCppHttpClient) {}

  status(): BackendStatus {
    return this.currentStatus;
  }

  protected setStatus(status: BackendStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  onStatusChange(listener: (status: BackendStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  complete(request: CompletionRequest) {
    return this.client.complete(request);
  }

  props() {
    return this.client.props();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}

class RemoteLlamaCppBackend extends BaseBackend {
  readonly id: string;
  readonly capabilities: Backend['capabilities'];

  constructor(options: RemoteOptions) {
    super(new LlamaCppHttpClient(options.url));
    this.id = `llamacpp:remote:${options.url}`;
    const kv = options.assumeKvPersistence ?? true;
    this.capabilities = { kvPersistence: kv, grammar: true };
    if (kv) this.slots = slotApi(this.client);
  }

  async start(): Promise<void> {
    this.setStatus('starting');
    if (await this.client.health()) {
      this.setStatus('ready');
      return;
    }
    this.setStatus('crashed');
    throw new Error(`Remote llama-server unreachable: ${this.client.baseUrl}`);
  }

  async stop(): Promise<void> {
    // Remote: we kill nothing, we simply detach.
    this.setStatus('stopped');
  }
}

class ManagedLlamaCppBackend extends BaseBackend {
  readonly id: string;
  readonly capabilities: Backend['capabilities'];

  private handle: ProcessHandle | null = null;
  private intentionalStop = false;
  private restartCount = 0;
  private readonly healthIntervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly maxRestarts: number;

  constructor(private readonly options: ManagedOptions) {
    super(
      new LlamaCppHttpClient(
        options.baseUrl ?? `http://127.0.0.1:${options.launch.port}`,
      ),
    );
    this.id = `llamacpp:managed:${options.launch.port}`;
    this.healthIntervalMs = options.healthIntervalMs ?? 500;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 120_000;
    this.maxRestarts = options.maxRestarts ?? 2;

    const kv = options.launch.slotSavePath !== undefined;
    this.capabilities = { kvPersistence: kv, grammar: true };
    if (kv) this.slots = slotApi(this.client);
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    this.restartCount = 0;
    await this.spawnAndWait('starting');
  }

  private async spawnAndWait(status: 'starting' | 'restarting'): Promise<void> {
    this.setStatus(status);

    const args = [
      ...(this.options.commandPrefix ?? []),
      ...buildLlamaServerArgs(this.options.launch),
    ];
    const handle = this.options.spawnFn(this.options.binPath, args);
    this.handle = handle;
    handle.onExit((code) => this.onProcessExit(handle, code));

    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.client.health()) {
        this.setStatus('ready');
        return;
      }
      await sleep(this.healthIntervalMs);
    }

    handle.kill();
    this.setStatus('crashed');
    throw new Error(
      `llama-server is not responding after ${this.healthTimeoutMs} ms (${this.client.baseUrl})`,
    );
  }

  private onProcessExit(handle: ProcessHandle, _code: number | null): void {
    if (this.handle !== handle) return; // process from a previous life
    this.handle = null;

    if (this.intentionalStop) {
      this.setStatus('stopped');
      return;
    }

    if (this.restartCount >= this.maxRestarts) {
      this.setStatus('crashed');
      return;
    }

    this.restartCount += 1;
    void this.spawnAndWait('restarting').catch(() => {
      // spawnAndWait has already set the 'crashed' status.
    });
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.handle?.kill();
    this.handle = null;
    this.setStatus('stopped');
  }
}

export function createLlamaCppBackend(options: LlamaCppBackendOptions): Backend {
  return options.mode === 'managed'
    ? new ManagedLlamaCppBackend(options)
    : new RemoteLlamaCppBackend(options);
}

export { buildLlamaServerArgs, LlamaCppHttpClient };
export { detectServeCommandPrefix } from './serve-command.js';
export type { LlamaCppLaunchConfig };
