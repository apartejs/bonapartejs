/**
 * Fake llama-server — HTTP fixture reused by every milestone to test the
 * harness without a GPU. Mimics the real endpoints (verified in
 * llama.cpp's README on 2026-08-18): POST /completion (SSE), POST
 * /slots/{id}?action=save|restore|erase, GET /slots, GET /health, GET /props.
 *
 * The "prefill" is simulated: timings.prompt_ms is proportional to the
 * tokens NOT covered by the slot's cache — that's what lets the tests
 * measure the effect of save/restore as on a real machine. No real sleep:
 * only the reported figure varies.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeSlotSnapshot {
  tokens: string[];
}

export interface FakeLlamaServerOptions {
  /** Simulated prefill ms per uncached token (default 1 — never a real sleep). */
  msPerToken?: number;
  /**
   * A REAL delay between two content chunks (default 0: the whole reply is
   * written at once). What lets a test act in the middle of a stream —
   * navigate, cancel — and see what a client saw so far.
   */
  paceMs?: number;
  /**
   * Context size the server enforces: a prompt longer than this is refused
   * with the 400 the real server sends when context shift is off.
   */
  nCtx?: number;
  /** Text generated for a given prompt (default: 'ok'). */
  responder?: (prompt: string) => string;
  /** Number of slots (default 1). */
  totalSlots?: number;
  modelPath?: string;
  /**
   * State files "disk": passing the same Map to a new instance simulates
   * a process restart with the files surviving.
   */
  files?: Map<string, FakeSlotSnapshot>;
}

export interface FakeLlamaServer {
  url: string;
  port: number;
  files: Map<string, FakeSlotSnapshot>;
  getSlotTokens(idSlot: number): string[];
  close(): Promise<void>;
}

/** Deterministic fake tokenizer: 1 token = 4 characters. */
export function fakeTokenize(prompt: string): string[] {
  return prompt.match(/.{1,4}/gs) ?? [];
}

/** Simulated bytes per token of saved state (realistic order of magnitude). */
const FAKE_BYTES_PER_TOKEN = 8192;

function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startFakeLlamaServer(
  options: FakeLlamaServerOptions = {},
): Promise<FakeLlamaServer> {
  const msPerToken = options.msPerToken ?? 1;
  const paceMs = options.paceMs ?? 0;
  const nCtx = options.nCtx;
  const responder = options.responder ?? (() => 'ok');
  const totalSlots = options.totalSlots ?? 1;
  const modelPath = options.modelPath ?? 'C:\\fake\\model.gguf';
  const files = options.files ?? new Map<string, FakeSlotSnapshot>();

  /**
   * Per-slot cache: the TEXT seen, tokenized on the fly. Storing the text
   * (rather than two concatenated tokenizations) reproduces the real
   * server, which tokenizes one continuous sequence — otherwise the
   * prompt/generation boundary would artificially break the common prefix.
   */
  const slots = new Map<number, string>();
  const slotText = (id: number): string => slots.get(id) ?? '';
  const slotTokens = (id: number): string[] => fakeTokenize(slotText(id));

  async function handleCompletion(
    body: Record<string, unknown>,
    res: ServerResponse,
  ): Promise<void> {
    const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : '';
    const rawSlot = body['id_slot'];
    const requestedSlot = typeof rawSlot === 'number' ? rawSlot : -1;
    const idSlot = requestedSlot === -1 ? 0 : requestedSlot;
    const cachePrompt = body['cache_prompt'] !== false;
    const returnProgress = body['return_progress'] === true;

    const tokens = fakeTokenize(prompt);
    if (nCtx !== undefined && tokens.length > nCtx) {
      // Wording and shape of llama-server's refusal (tools/server).
      json(res, 400, {
        error: {
          code: 400,
          message:
            'the request exceeds the available context size. try increasing the context size or enable context shift',
          type: 'invalid_request_error',
        },
      });
      return;
    }
    const cached = cachePrompt
      ? commonPrefixLength(slotTokens(idSlot), tokens)
      : 0;
    const uncached = tokens.length - cached;
    const promptMs = uncached * msPerToken;

    const text = responder(prompt);
    slots.set(idSlot, prompt + text);

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });

    // Shape verified against a real llama-server on 2026-08-28: with
    // `return_progress`, `prompt_progress` arrives in INTERMEDIATE events
    // (one at the start of prompt processing, one at its end), never in the
    // final one. The final event carries the authoritative counts in
    // `timings` (`cache_n`, `prompt_n`) plus `tokens_cached` — the KV size
    // after generation — and `tokens_evaluated`. A fake that put the
    // progress on the final event hid a client that read it only there.
    if (returnProgress) {
      for (const processed of [cached, tokens.length]) {
        const progress = {
          total: tokens.length,
          cache: cached,
          processed,
          time_ms: processed === tokens.length ? promptMs : 0,
        };
        res.write(
          `data: ${JSON.stringify({ content: '', stop: false, prompt_progress: progress })}\n\n`,
        );
      }
    }

    // One content chunk per "word" for a real multi-event stream. With a
    // pace, a client that goes away mid-stream (cancel) ends the stream
    // where it stood, as llama-server does when the connection drops.
    const pieces = text.split(/(?<= )/);
    for (const piece of pieces) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ content: piece, stop: false })}\n\n`);
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
    if (res.destroyed) return;

    const predicted = fakeTokenize(text).length;
    const final: Record<string, unknown> = {
      content: '',
      stop: true,
      id_slot: idSlot,
      tokens_predicted: predicted,
      tokens_evaluated: tokens.length,
      tokens_cached: tokens.length + predicted,
      timings: {
        cache_n: cached,
        prompt_n: uncached,
        prompt_ms: promptMs,
        predicted_n: predicted,
        predicted_ms: predicted * msPerToken,
      },
    };
    res.write(`data: ${JSON.stringify(final)}\n\n`);
    res.end();
  }

  function handleSlotAction(
    idSlot: number,
    action: string,
    body: Record<string, unknown>,
    res: ServerResponse,
  ): void {
    if (idSlot < 0 || idSlot >= totalSlots) {
      json(res, 400, { error: { message: `slot ${idSlot} does not exist` } });
      return;
    }

    if (action === 'save') {
      const filename = String(body['filename'] ?? '');
      if (!filename) {
        json(res, 400, { error: { message: 'filename required' } });
        return;
      }
      const tokens = slotTokens(idSlot);
      files.set(filename, { tokens });
      json(res, 200, {
        id_slot: idSlot,
        filename,
        n_saved: tokens.length,
        n_written: tokens.length * FAKE_BYTES_PER_TOKEN,
        timings: { save_ms: 1 },
      });
      return;
    }

    if (action === 'restore') {
      const filename = String(body['filename'] ?? '');
      const snapshot = files.get(filename);
      if (!snapshot) {
        json(res, 400, { error: { message: `unknown file: ${filename}` } });
        return;
      }
      slots.set(idSlot, snapshot.tokens.join(''));
      json(res, 200, {
        id_slot: idSlot,
        filename,
        n_restored: snapshot.tokens.length,
        n_read: snapshot.tokens.length * FAKE_BYTES_PER_TOKEN,
        timings: { restore_ms: 1 },
      });
      return;
    }

    if (action === 'erase') {
      const erased = slotTokens(idSlot).length;
      slots.set(idSlot, '');
      json(res, 200, { id_slot: idSlot, n_erased: erased });
      return;
    }

    json(res, 400, { error: { message: `unknown action: ${action}` } });
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { status: 'ok' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/props') {
        json(res, 200, {
          model_path: modelPath,
          total_slots: totalSlots,
          chat_template: '',
          default_generation_settings: {},
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/slots') {
        const list = Array.from({ length: totalSlots }, (_, id) => ({
          id_slot: id,
          n_ctx_used: slotTokens(id).length,
        }));
        json(res, 200, list);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/completion') {
        handleCompletion(await readBody(req), res);
        return;
      }

      const slotMatch = url.pathname.match(/^\/slots\/(-?\d+)$/);
      if (req.method === 'POST' && slotMatch) {
        handleSlotAction(
          Number(slotMatch[1]),
          url.searchParams.get('action') ?? '',
          await readBody(req),
          res,
        );
        return;
      }

      json(res, 404, { error: { message: 'not found' } });
    })().catch((err) => {
      json(res, 500, { error: { message: String(err) } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    files,
    getSlotTokens: (idSlot) => [...slotTokens(idSlot)],
    // Idempotent: closing an already-closed server again is a no-op (fixture).
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
