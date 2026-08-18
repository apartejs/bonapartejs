/**
 * Backend OpenAI-compatible — LM Studio, Ollama, vLLM… et, avec une clé, les
 * API cloud. C'est LA preuve que la boucle est agnostique : ici, pas de prompt
 * brut, pas de grammaire, pas de format Hermes — des `messages[]`, des outils
 * déclarés en JSON, et des appels d'outils déjà structurés par le serveur.
 *
 * Le format est délégué à `@aparte/provider-openai-compat` : `buildRequest()`
 * fabrique le corps de la requête, `parseStream()` démultiplexe le SSE. Ce
 * paquet sépare proprement le FORMAT du TRANSPORT, donc bonaparte garde son
 * `fetch` (son signal d'annulation, son URL, ses en-têtes) et n'emprunte que
 * la partie « dialecte OpenAI ». Notre travail se réduit à traduire notre
 * transcript en messages aparté, et les événements aparté en `ProviderEvent`.
 */

import { createOpenAICompatProvider } from '@aparte/provider-openai-compat';
import type {
  AparteChatMessage,
  AparteTool,
  AparteUsage,
} from '@aparte/core';
import type {
  Backend,
  BackendStatus,
  CompletionEvent,
  CompletionRequest,
  ProviderEvent,
  ServerProps,
  SlotApi,
  ToolDefLike,
  TranscriptEntry,
  TurnRequest,
} from '../types.js';
import { buildSystemPrompt } from '../../wire/system-prompt.js';
import { HermesStreamDemux } from '../../wire/stream-demux.js';

export interface OpenAiCompatOptions {
  /** Base de l'API, ex. http://127.0.0.1:1234/v1 (LM Studio). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Étiquette lisible (« LM Studio », « OpenAI »…). */
  label?: string;
}

/**
 * Transcript sémantique → messages aparté. C'est notre seule responsabilité de
 * format : la traduction vers le dialecte OpenAI appartient au provider.
 */
export function toChatMessages(
  systemPrompt: string,
  transcript: TranscriptEntry[],
): AparteChatMessage[] {
  const messages: AparteChatMessage[] = [{ role: 'system', content: systemPrompt }];
  let callSeq = 0;
  /** Ids attribués aux appels du dernier tour, pour lier les résultats. */
  let lastCallIds: string[] = [];

  for (const entry of transcript) {
    switch (entry.role) {
      case 'user':
      case 'service':
        messages.push({ role: 'user', content: entry.text });
        break;
      case 'assistant': {
        const calls = entry.calls ?? [];
        // Un tour assistant sans appel reste un tour assistant : il ne doit pas
        // écraser les ids et orpheliner les résultats du tour précédent.
        if (calls.length === 0) {
          messages.push({ role: 'assistant', content: entry.text });
          break;
        }
        lastCallIds = calls.map(() => `call_${callSeq++}`);
        messages.push({
          role: 'tool_call',
          content: entry.text,
          // Le texte dit avant l'appel : le provider le remet dans `content`.
          precedingText: entry.text,
          toolCalls: calls.map((call, index) => ({
            id: lastCallIds[index] as string,
            name: call.name,
            input: call.arguments,
          })),
        });
        break;
      }
      case 'tool_results':
        entry.results.forEach((result, index) => {
          messages.push({
            role: 'tool_result',
            toolCallId: lastCallIds[index] ?? `call_${index}`,
            content: `${result.ok ? '' : '[failed] '}${result.content}`,
          });
        });
        break;
    }
  }
  return messages;
}

/** Outils bonaparte → outils aparté (le provider en fait des `function`). */
export function toChatTools(tools: ToolDefLike[]): AparteTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function createOpenAiCompatBackend(options: OpenAiCompatOptions): Backend {
  let status: BackendStatus = 'stopped';
  const listeners = new Set<(status: BackendStatus) => void>();
  const setStatus = (next: BackendStatus): void => {
    status = next;
    for (const listener of listeners) listener(next);
  };

  // `isLocal` : sans clé, un serveur local est le cas normal, pas une erreur
  // de configuration.
  const provider = createOpenAICompatProvider({
    id: options.label ?? 'openai-compat',
    baseURL: options.baseUrl,
    ...(options.label ? { name: options.label } : {}),
    isLocal: !options.apiKey,
  });

  // `AparteAIProvider` déclare la surface d'adaptateur de format en optionnel
  // (un provider peut, à la place, faire ses I/O lui-même) — la factory, elle,
  // la fournit toujours. On vérifie une fois, avec un message utile, plutôt
  // que de semer des `!` qui mentiraient le jour où ça changerait.
  const { buildRequest, parseStream } = provider;
  if (!buildRequest || !parseStream) {
    throw new Error(
      'Le provider OpenAI-compatible n’expose plus buildRequest/parseStream : ' +
        'la surface d’adaptateur de format d’@aparte/provider-openai-compat a changé.',
    );
  }

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(options.apiKey
      ? (provider.authHeaders?.(options.apiKey) ?? {
          Authorization: `Bearer ${options.apiKey}`,
        })
      : {}),
  });

  const backend: Backend = {
    id: `openai-compat:${options.baseUrl}`,
    typeId: 'openai-compat',
    // Ni persistance de contexte (pas de slots), ni grammaire : l'UI dégrade
    // honnêtement au lieu de promettre une reprise instantanée.
    capabilities: { kvPersistence: false, grammar: false },
    status: () => status,

    start: async () => {
      setStatus('starting');
      try {
        const res = await fetch(`${options.baseUrl}/models`, { headers: headers() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus('ready');
      } catch (error) {
        setStatus('crashed');
        throw new Error(
          `Endpoint OpenAI-compatible injoignable (${options.baseUrl}) : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    stop: async () => setStatus('stopped'),
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async *runTurn(request: TurnRequest): AsyncIterable<ProviderEvent> {
      const systemPrompt = buildSystemPrompt({
        ...(request.system.projectRoot
          ? { projectRoot: request.system.projectRoot }
          : {}),
        // Le serveur gère les outils nativement : ils sont déclarés dans le
        // corps de la requête, et le prompt tait la convention textuelle.
        tools: [],
        toolCallFormat: false,
        ...(request.system.replyLanguage
          ? { replyLanguage: request.system.replyLanguage }
          : {}),
        ...(request.system.projectInstructions
          ? { projectInstructions: request.system.projectInstructions }
          : {}),
      });

      const built = buildRequest({
        modelId: options.model,
        messages: toChatMessages(systemPrompt, request.transcript),
        stream: true,
        ...(request.tools.length > 0 ? { tools: toChatTools(request.tools) } : {}),
      });

      const res = await fetch(`${options.baseUrl}${built.path}`, {
        method: 'POST',
        headers: { ...headers(), ...built.headers },
        signal: request.signal,
        body: JSON.stringify(built.body),
      });
      if (!res.ok || !res.body) {
        throw new Error(
          `${options.label ?? 'endpoint'} a répondu ${res.status} : ${(
            await res.text().catch(() => '')
          ).slice(0, 300)}`,
        );
      }

      const started = Date.now();
      // Deux façons d'émettre le raisonnement coexistent chez les serveurs
      // compatibles : le champ `reasoning_content`, que le provider traduit en
      // événement `thinking`, ou des balises `<think>` au milieu du contenu,
      // qu'il laisse passer — d'où le démultiplexeur sur le texte, sinon
      // l'utilisateur lit les balises brutes. Les blocs `<tool_call>` restent
      // visibles : le serveur gère les outils nativement, un bloc texte y
      // serait une bizarrerie du modèle et la masquer ferait disparaître une
      // intention sans laisser de trace.
      const demux = new HermesStreamDemux({ keepToolCalls: true });
      // CONTOURNEMENT (à retirer dès correction de la lib) : `parseStream`
      // sort dès `finish_reason: "tool_calls"`, donc AVANT le chunk d'usage
      // que `include_usage` — demandé par son propre `buildRequest` — envoie
      // ensuite. Sur un agent, la plupart des tours finissent par un appel :
      // sans cette dérivation, la barre de statut afficherait zéro token la
      // moitié du temps. On duplique donc le flux et on relit la queue nous-
      // mêmes uniquement si l'usage manque.
      const [forParser, forUsage] = res.body.tee();
      const reader = parseStream(forParser).getReader();
      let usage: AparteUsage | undefined;
      let drained = false;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          switch (value.type) {
            case 'text':
              for (const event of demux.push(value.delta)) yield event;
              break;
            case 'thinking':
              yield { type: 'thinking', delta: value.delta };
              break;
            case 'tool_use':
              // Le texte retenu par le démultiplexeur doit sortir avant
              // l'appel : sinon la phrase précédant l'outil arrive après lui.
              for (const event of demux.flush()) yield event;
              yield {
                type: 'tool_use',
                call: { name: value.name, arguments: value.input },
              };
              break;
            case 'done':
              usage = value.usage;
              break;
            case 'error':
              throw new Error(value.message);
          }
        }
        drained = true;
      } finally {
        // Annuler propage jusqu'au corps de la réponse : un `stop` utilisateur
        // ne doit pas laisser le serveur générer dans le vide. La branche de
        // secours doit partir avec, sinon elle reste verrouillée pour rien.
        await reader.cancel().catch(() => undefined);
        if (!drained) await forUsage.cancel().catch(() => undefined);
      }

      usage ??= await readTrailingUsage(forUsage);

      // Un fragment de balise retenu en fin de flux doit ressortir.
      for (const event of demux.flush()) yield event;

      const cached = usage?.cacheReadTokens;
      yield {
        type: 'done',
        stats: {
          // Le serveur ne rapporte pas de durée de prefill : 0 plutôt qu'un
          // chiffre inventé. Les tokens viennent de l'usage réel, jamais
          // d'un comptage de caractères.
          promptMs: 0,
          promptUncachedTokens:
            usage && cached !== undefined
              ? Math.max(0, usage.inputTokens - cached)
              : (usage?.inputTokens ?? 0),
          predictedTokens: usage?.outputTokens ?? 0,
          predictedMs: Date.now() - started,
          // Certains serveurs (dont LM Studio récent) rapportent la part de
          // prompt servie par leur cache : on l'affiche telle quelle.
          ...(usage && cached !== undefined
            ? {
                progress: {
                  total: usage.inputTokens,
                  cache: cached,
                  processed: usage.inputTokens,
                  timeMs: 0,
                },
              }
            : {}),
        },
      };
    },

    async *complete(_request: CompletionRequest): AsyncIterable<CompletionEvent> {
      throw new Error(
        'Ce backend n’expose pas de complétion brute : il parle /chat/completions.',
      );
    },

    props: async (): Promise<ServerProps> => ({
      modelPath: options.model,
      totalSlots: 1,
      chatTemplate: '',
    }),
  };

  // Pas de slots : la capacité déclarée dit déjà la vérité.
  const noSlots: SlotApi | undefined = undefined;
  backend.slots = noSlots;
  return backend;
}

/**
 * Dernier objet `usage` d'un flux SSE, ou `undefined`. Filet de secours pour
 * le tour qui finit par un appel d'outil — disparaît avec le contournement.
 */
async function readTrailingUsage(
  stream: ReadableStream<Uint8Array>,
): Promise<AparteUsage | undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let found: AparteUsage | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === '[DONE]') continue;
      try {
        const usage = (
          JSON.parse(raw) as {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              prompt_tokens_details?: { cached_tokens?: number };
            };
          }
        ).usage;
        if (!usage) continue;
        found = {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
          ...(usage.prompt_tokens_details?.cached_tokens !== undefined
            ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens }
            : {}),
        };
      } catch {
        // Ligne inexploitable : le filet de secours ne doit jamais faire
        // échouer un tour par ailleurs réussi.
      }
    }
  } catch {
    // idem : pas d'usage vaut mieux qu'un tour perdu.
  } finally {
    reader.releaseLock();
  }
  return found;
}
