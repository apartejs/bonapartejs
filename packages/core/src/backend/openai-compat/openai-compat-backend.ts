/**
 * Backend OpenAI-compatible — LM Studio, Ollama, vLLM… et, avec une clé, les
 * API cloud. C'est LA preuve que la boucle est agnostique : ici, pas de prompt
 * brut, pas de grammaire, pas de format Hermes — des `messages[]`, des outils
 * déclarés en JSON, et des appels d'outils déjà structurés par le serveur.
 *
 * Note : `@aparte/provider-openai-compat` fait exactement ce mapping, mais
 * n'est pas importable depuis Node aujourd'hui (son import runtime de
 * `@aparte/core` charge les web components, qui touchent `customElements` au
 * niveau module). Cet adaptateur le remplace en attendant — voir le journal
 * de friction ; il sera remplacé par le provider de la lib dès que possible.
 */

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

export interface OpenAiCompatOptions {
  /** Base de l'API, ex. http://127.0.0.1:1234/v1 (LM Studio). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Étiquette lisible (« LM Studio », « OpenAI »…). */
  label?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

/** Transcript sémantique → messages OpenAI. */
export function toChatMessages(
  systemPrompt: string,
  transcript: TranscriptEntry[],
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
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
        lastCallIds = calls.map(() => `call_${callSeq++}`);
        messages.push({
          role: 'assistant',
          content: entry.text,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((call, index) => ({
                  id: lastCallIds[index] as string,
                  type: 'function' as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        });
        break;
      }
      case 'tool_results':
        entry.results.forEach((result, index) => {
          messages.push({
            role: 'tool',
            tool_call_id: lastCallIds[index] ?? `call_${index}`,
            content: `${result.ok ? '' : '[failed] '}${result.content}`,
          });
        });
        break;
    }
  }
  return messages;
}

/** Outils bonaparte → schéma d'outils OpenAI. */
export function toChatTools(tools: ToolDefLike[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

interface StreamingCall {
  name: string;
  args: string;
}

export function createOpenAiCompatBackend(options: OpenAiCompatOptions): Backend {
  let status: BackendStatus = 'stopped';
  const listeners = new Set<(status: BackendStatus) => void>();
  const setStatus = (next: BackendStatus): void => {
    status = next;
    for (const listener of listeners) listener(next);
  };

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
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
        projectRoot: request.system.projectRoot,
        // Pas de bloc « format d'appel » : le serveur gère les outils nativement.
        tools: [],
        ...(request.system.replyLanguage
          ? { replyLanguage: request.system.replyLanguage }
          : {}),
        ...(request.system.projectInstructions
          ? { projectInstructions: request.system.projectInstructions }
          : {}),
      });

      const res = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        signal: request.signal,
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages: toChatMessages(systemPrompt, request.transcript),
          ...(request.tools.length > 0 ? { tools: toChatTools(request.tools) } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(
          `${options.label ?? 'endpoint'} a répondu ${res.status} : ${(
            await res.text().catch(() => '')
          ).slice(0, 300)}`,
        );
      }

      const started = Date.now();
      const calls = new Map<number, StreamingCall>();
      let text = '';

      for await (const chunk of sseChunks(res.body)) {
        const delta = chunk?.choices?.[0]?.delta as
          | {
              content?: string;
              reasoning_content?: string;
              tool_calls?: {
                index: number;
                function?: { name?: string; arguments?: string };
              }[];
            }
          | undefined;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          yield { type: 'text', delta: delta.content };
        }
        if (delta.reasoning_content) {
          yield { type: 'thinking', delta: delta.reasoning_content };
        }
        // Les arguments arrivent en fragments : on accumule par index.
        for (const part of delta.tool_calls ?? []) {
          const current = calls.get(part.index) ?? { name: '', args: '' };
          if (part.function?.name) current.name = part.function.name;
          if (part.function?.arguments) current.args += part.function.arguments;
          calls.set(part.index, current);
        }
      }

      for (const call of [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value)) {
        yield {
          type: 'tool_use',
          call: { name: call.name, arguments: safeJson(call.args) },
        };
      }

      yield {
        type: 'done',
        stats: {
          // Pas de cache de préfixe côté serveur : le prefill n'est pas mesuré.
          promptMs: 0,
          promptUncachedTokens: 0,
          predictedTokens: text.length,
          predictedMs: Date.now() - started,
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

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Itère les objets JSON d'un flux SSE `data: {...}` (bufferisé). */
async function* sseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ choices?: { delta?: unknown }[] }> {
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
        if (!block.startsWith('data: ')) continue;
        const payload = block.slice('data: '.length);
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {
          // fragment inexploitable : ignoré
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
