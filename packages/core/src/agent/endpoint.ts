/**
 * The endpoint path (task 9.2): a turn of a conversation on a service that speaks OpenAI's API runs in aparté's
 * own agent handler — the service's loop, the history the window sends —, with the core's tools and its one
 * approval policy. Nothing of the built-in engine is touched: no slot, no frozen prompt, no memory.
 *
 * The handler is made for the turn: the service, its key (from the vault), its model, the conversation's tools
 * and its policy as they stand. A pause is signed with the installation's secret, as the core's own, and
 * resumed through the same address.
 */

import { createAparteAgentHandler, type AparteTool } from '@aparte/core';
import { createOpenAICompatProvider } from '@aparte/provider-openai-compat';
import type { Verdict } from '@aparte/bonaparte-shared';
import type { Provider } from '../providers/registry.js';
import type { ToolDef, ToolResult } from '../tools/types.js';

export interface ServiceTurn {
  provider: Provider;
  key: string | undefined;
  model: string;
  /** The conversation's tools that run in the core (the window's run in the window). */
  tools: readonly ToolDef[];
  run(call: { id: string; name: string; input: unknown }, signal: AbortSignal): Promise<ToolResult>;
  /** The core's one policy, in the conversation's mode and perimeter. */
  judge(tool: ToolDef, input: unknown): Verdict;
  system: string;
  secret: string;
  maxTurns: number;
}

/** A line of the turn's stream, as aparté's handler writes it. */
export type ServiceLine = { type: string; [key: string]: unknown };

/**
 * Serves the turn the window posted (`raw`: its body, a resume included) on the service; `onLine` hears each
 * line of the stream as it goes to the window.
 */
export async function serveOnService(
  turn: ServiceTurn,
  raw: Record<string, unknown>,
  request: Request,
  onLine: (line: ServiceLine) => void | Promise<void>,
): Promise<Response> {
  const byName = new Map(turn.tools.map((tool) => [tool.name, tool]));
  const handler = createAparteAgentHandler({
    providers: {
      [turn.provider.id]: createOpenAICompatProvider({
        id: turn.provider.id,
        name: turn.provider.label,
        baseURL: turn.provider.url ?? '',
        isLocal: true,
        ...(turn.provider.server && turn.provider.server !== 'openai' ? { server: turn.provider.server } : {}),
      }),
    },
    defaultModel: turn.model,
    // The address is reached only through the app's own protocol: the window is the only caller.
    authorize: () => true,
    secret: turn.secret,
    resolveKey: () => turn.key,
    tools: turn.tools.map((def) => ({
      tool: { name: def.name, description: def.description, inputSchema: def.inputSchema } satisfies AparteTool,
      handler: async (call, signal) => {
        const result = await turn.run({ id: call.id, name: call.name, input: call.input }, signal);
        return {
          toolCallId: call.id,
          content: result.content,
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        };
      },
    })),
    approvalPolicy: (call) => {
      const def = byName.get(call.name);
      // The window's tools (ask_user) are the window's: aparté pauses for them itself.
      if (!def) return undefined;
      const verdict = turn.judge(def, call.input);
      return verdict.verdict === 'deny' ? { verdict: 'deny', reason: verdict.reason } : { verdict: verdict.verdict };
    },
    clientTools: ['ask_user'],
    prepareRequest: (chat) => ({
      ...chat,
      modelId: turn.model,
      messages: [{ role: 'system', content: turn.system }, ...chat.messages.filter((message) => message.role !== 'system')],
    }),
    maxTurns: turn.maxTurns,
    // A write or a command never passes one that waits for the person (aparté 1.8).
    parallelTools: false,
  });
  const body = {
    ...raw,
    providerId: turn.provider.id,
    request: { ...(raw['request'] as Record<string, unknown>), modelId: turn.model },
  };
  const response = await handler(
    new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    }),
  );
  if (!response.body || !/ndjson/.test(response.headers.get('content-type') ?? '')) return response;
  return new Response(tee(response.body, onLine), { status: response.status, headers: response.headers });
}

/** The stream as it goes to the window, each of its lines heard on the way. */
function tee(body: ReadableStream<Uint8Array>, onLine: (line: ServiceLine) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffered = '';
  const hear = (text: string): void => {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        onLine(JSON.parse(line) as ServiceLine);
      } catch {
        // Not a line of the wire: it goes to the window as it is.
      }
    }
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const cut = buffered.lastIndexOf('\n');
        if (cut >= 0) {
          hear(buffered.slice(0, cut));
          buffered = buffered.slice(cut + 1);
        }
        controller.enqueue(chunk);
      },
      flush() {
        hear(buffered + decoder.decode());
      },
    }),
  );
}
