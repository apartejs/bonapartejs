/**
 * llama-server HTTP client — talks ONLY to /completion (raw prompt, never
 * /v1/chat/completions: Qwen3 re-templating is not byte-stable), to the
 * slots (save/restore/erase), and to /props (capability detection).
 */

import type {
  CompletionEvent,
  CompletionRequest,
  ServerProps,
  SlotRestoreResult,
  SlotSaveResult,
} from '../types.js';

export class LlamaCppHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LlamaCppHttpError';
  }
}

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LlamaCppHttpError(
      `llama-server ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/**
 * Iterates the SSE `data: {...}` events of a stream, buffering — a network
 * chunk can cut an event in two.
 */
async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (block.startsWith('data: ')) {
          yield JSON.parse(block.slice('data: '.length)) as Record<
            string,
            unknown
          >;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function toCompletionBody(request: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    stream: true,
    id_slot: request.idSlot ?? -1,
    cache_prompt: request.cachePrompt ?? true,
  };
  if (request.returnProgress) body['return_progress'] = true;
  if (request.nPredict !== undefined) body['n_predict'] = request.nPredict;
  if (request.grammar !== undefined) body['grammar'] = request.grammar;
  if (request.jsonSchema !== undefined) body['json_schema'] = request.jsonSchema;
  if (request.grammarLazy !== undefined) body['grammar_lazy'] = request.grammarLazy;
  if (request.grammarTriggers !== undefined) {
    body['grammar_triggers'] = request.grammarTriggers;
  }
  if (request.preservedTokens !== undefined) {
    body['preserved_tokens'] = request.preservedTokens;
  }
  const s = request.sampling;
  if (s?.temperature !== undefined) body['temperature'] = s.temperature;
  if (s?.topK !== undefined) body['top_k'] = s.topK;
  if (s?.topP !== undefined) body['top_p'] = s.topP;
  if (s?.minP !== undefined) body['min_p'] = s.minP;
  if (s?.seed !== undefined) body['seed'] = s.seed;
  if (s?.stop !== undefined) body['stop'] = s.stop;
  return body;
}

export class LlamaCppHttpClient {
  /** `apiKey`: sent as `Authorization: Bearer` on every request (the managed server demands it). */
  constructor(
    readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.apiKey ? { ...extra, authorization: `Bearer ${this.apiKey}` } : extra;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  async props(): Promise<ServerProps> {
    const raw = await expectJson<Record<string, unknown>>(
      await fetch(`${this.baseUrl}/props`, { headers: this.headers() }),
    );
    return {
      modelPath: String(raw['model_path'] ?? ''),
      totalSlots: Number(raw['total_slots'] ?? 1),
      chatTemplate: String(raw['chat_template'] ?? ''),
    };
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionEvent> {
    const res = await fetch(`${this.baseUrl}/completion`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(toCompletionBody(request)),
      signal: request.signal ?? null,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new LlamaCppHttpError(
        `llama-server ${res.status}: ${text.slice(0, 300)}`,
        res.status,
      );
    }

    // `prompt_progress` travels in INTERMEDIATE events (with `return_progress`),
    // never in the final one — verified on a real server on 2026-08-28. The
    // final event carries the counts that make the figure authoritative:
    // `timings.cache_n` (prompt tokens served from the cache) and
    // `timings.prompt_n` (prompt tokens actually processed). Read from the
    // final event only, the progress was always missing, and every real turn
    // reported zero cached tokens.
    let lastProgress: Record<string, unknown> | undefined;
    for await (const event of sseEvents(res.body)) {
      const content = event['content'];
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'token', text: content };
      }
      const progress = event['prompt_progress'];
      if (progress && typeof progress === 'object') {
        lastProgress = progress as Record<string, unknown>;
        const total = Number(lastProgress['total'] ?? 0);
        yield {
          type: 'progress',
          progress: {
            total,
            cache: Number(lastProgress['cache'] ?? 0),
            processed: Number(lastProgress['processed'] ?? 0),
            timeMs: Number(lastProgress['time_ms'] ?? 0),
          },
        };
      }
      if (event['stop'] === true) {
        const timings = (event['timings'] ?? {}) as Record<string, unknown>;
        const promptMs = Number(timings['prompt_ms'] ?? 0);
        const uncached = Number(timings['prompt_n'] ?? 0);
        const cacheN = timings['cache_n'];
        const cached =
          cacheN !== undefined ? Number(cacheN) : Number(lastProgress?.['cache'] ?? 0);
        const total = lastProgress
          ? Number(lastProgress['total'] ?? cached + uncached)
          : cached + uncached;
        yield {
          type: 'done',
          stats: {
            promptMs,
            promptUncachedTokens: uncached,
            predictedTokens: Number(timings['predicted_n'] ?? 0),
            predictedMs: Number(timings['predicted_ms'] ?? 0),
            contextTokens: Number(event['tokens_cached'] ?? 0),
            // The server sets this when it stopped at the context ceiling
            // (server-context.cpp: slot.truncated). The reply is incomplete.
            truncated: event['truncated'] === true,
            progress: {
              total,
              cache: cached,
              processed: lastProgress ? Number(lastProgress['processed'] ?? total) : total,
              timeMs: lastProgress ? Number(lastProgress['time_ms'] ?? promptMs) : promptMs,
            },
          },
        };
        return;
      }
    }
  }

  private async slotAction<T>(
    idSlot: number,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/slots/${idSlot}?action=${action}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    });
    return expectJson<T>(res);
  }

  async saveSlot(idSlot: number, filename: string): Promise<SlotSaveResult> {
    const raw = await this.slotAction<Record<string, unknown>>(idSlot, 'save', {
      filename,
    });
    const timings = (raw['timings'] ?? {}) as Record<string, unknown>;
    return {
      idSlot: Number(raw['id_slot'] ?? idSlot),
      filename: String(raw['filename'] ?? filename),
      nSaved: Number(raw['n_saved'] ?? 0),
      nWritten: Number(raw['n_written'] ?? 0),
      saveMs: Number(timings['save_ms'] ?? 0),
    };
  }

  async restoreSlot(
    idSlot: number,
    filename: string,
  ): Promise<SlotRestoreResult> {
    const raw = await this.slotAction<Record<string, unknown>>(
      idSlot,
      'restore',
      { filename },
    );
    const timings = (raw['timings'] ?? {}) as Record<string, unknown>;
    return {
      idSlot: Number(raw['id_slot'] ?? idSlot),
      filename: String(raw['filename'] ?? filename),
      nRestored: Number(raw['n_restored'] ?? 0),
      nRead: Number(raw['n_read'] ?? 0),
      restoreMs: Number(timings['restore_ms'] ?? 0),
    };
  }

  async eraseSlot(idSlot: number): Promise<number> {
    const raw = await this.slotAction<Record<string, unknown>>(idSlot, 'erase');
    return Number(raw['n_erased'] ?? 0);
  }
}
