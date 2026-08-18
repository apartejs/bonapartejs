/**
 * Faux llama-server — fixture HTTP réutilisée par tous les jalons pour tester
 * le harness sans GPU. Mime les endpoints réels (vérifiés dans le README de
 * llama.cpp le 2026-08-18) : POST /completion (SSE), POST /slots/{id}?action=
 * save|restore|erase, GET /slots, GET /health, GET /props.
 *
 * Le « prefill » est simulé : timings.prompt_ms est proportionnel aux tokens
 * NON couverts par le cache du slot — c'est ce qui permet aux tests de
 * mesurer l'effet du save/restore comme sur une vraie machine. Aucun sleep
 * réel : seul le chiffre rapporté varie.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeSlotSnapshot {
  tokens: string[];
}

export interface FakeLlamaServerOptions {
  /** ms de prefill simulé par token non caché (défaut 1 — jamais de sleep réel). */
  msPerToken?: number;
  /** Texte généré pour un prompt donné (défaut : 'ok'). */
  responder?: (prompt: string) => string;
  /** Nombre de slots (défaut 1). */
  totalSlots?: number;
  modelPath?: string;
  /**
   * « Disque » des fichiers d'état : passer la même Map à une nouvelle
   * instance simule un redémarrage du process avec les fichiers survivants.
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

/** Tokenizer factice déterministe : 1 token = 4 caractères. */
export function fakeTokenize(prompt: string): string[] {
  return prompt.match(/.{1,4}/gs) ?? [];
}

/** Octets simulés par token d'état sauvegardé (ordre de grandeur réaliste). */
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
  const responder = options.responder ?? (() => 'ok');
  const totalSlots = options.totalSlots ?? 1;
  const modelPath = options.modelPath ?? 'C:\\fake\\model.gguf';
  const files = options.files ?? new Map<string, FakeSlotSnapshot>();

  /**
   * Cache par slot : le TEXTE vu, tokenisé à la volée. Stocker le texte
   * (plutôt que deux tokenisations concaténées) reproduit le vrai serveur,
   * qui tokenise une séquence continue — sinon la frontière prompt/génération
   * casserait artificiellement le préfixe commun.
   */
  const slots = new Map<number, string>();
  const slotText = (id: number): string => slots.get(id) ?? '';
  const slotTokens = (id: number): string[] => fakeTokenize(slotText(id));

  function handleCompletion(
    body: Record<string, unknown>,
    res: ServerResponse,
  ): void {
    const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : '';
    const rawSlot = body['id_slot'];
    const requestedSlot = typeof rawSlot === 'number' ? rawSlot : -1;
    const idSlot = requestedSlot === -1 ? 0 : requestedSlot;
    const cachePrompt = body['cache_prompt'] !== false;
    const returnProgress = body['return_progress'] === true;

    const tokens = fakeTokenize(prompt);
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

    // Un chunk de contenu par « mot » pour un vrai flux multi-événements.
    const pieces = text.split(/(?<= )/);
    for (const piece of pieces) {
      res.write(`data: ${JSON.stringify({ content: piece, stop: false })}\n\n`);
    }

    const final: Record<string, unknown> = {
      content: '',
      stop: true,
      id_slot: idSlot,
      tokens_predicted: fakeTokenize(text).length,
      timings: {
        prompt_n: uncached,
        prompt_ms: promptMs,
        predicted_n: fakeTokenize(text).length,
        predicted_ms: fakeTokenize(text).length * msPerToken,
      },
    };
    if (returnProgress) {
      final['prompt_progress'] = {
        total: tokens.length,
        cache: cached,
        processed: tokens.length,
        time_ms: promptMs,
      };
    }
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
      json(res, 400, { error: { message: `slot ${idSlot} inexistant` } });
      return;
    }

    if (action === 'save') {
      const filename = String(body['filename'] ?? '');
      if (!filename) {
        json(res, 400, { error: { message: 'filename requis' } });
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
        json(res, 400, { error: { message: `fichier inconnu : ${filename}` } });
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

    json(res, 400, { error: { message: `action inconnue : ${action}` } });
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
    // Idempotent : re-fermer un serveur déjà fermé est un no-op (fixture).
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
