/**
 * Client HTTP llama-server — parle UNIQUEMENT à /completion (prompt brut,
 * jamais /v1/chat/completions : re-templating Qwen3 non byte-stable), aux
 * slots (save/restore/erase) et à /props (détection de capacités).
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
 * Itère les événements SSE `data: {...}` d'un flux, en bufferisant — un
 * chunk réseau peut couper un événement en deux.
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
  constructor(readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async props(): Promise<ServerProps> {
    const raw = await expectJson<Record<string, unknown>>(
      await fetch(`${this.baseUrl}/props`),
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
      headers: { 'content-type': 'application/json' },
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

    for await (const event of sseEvents(res.body)) {
      const content = event['content'];
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'token', text: content };
      }
      if (event['stop'] === true) {
        const timings = (event['timings'] ?? {}) as Record<string, unknown>;
        const progress = event['prompt_progress'] as
          | Record<string, unknown>
          | undefined;
        yield {
          type: 'done',
          stats: {
            promptMs: Number(timings['prompt_ms'] ?? 0),
            promptUncachedTokens: Number(timings['prompt_n'] ?? 0),
            predictedTokens: Number(timings['predicted_n'] ?? 0),
            predictedMs: Number(timings['predicted_ms'] ?? 0),
            ...(progress
              ? {
                  progress: {
                    total: Number(progress['total'] ?? 0),
                    cache: Number(progress['cache'] ?? 0),
                    processed: Number(progress['processed'] ?? 0),
                    timeMs: Number(progress['time_ms'] ?? 0),
                  },
                }
              : {}),
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
      headers: { 'content-type': 'application/json' },
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
