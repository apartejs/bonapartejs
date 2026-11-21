/**
 * A sub-agent on a service (audit S1, S3): the person's Ollama, LM Studio, a llama-server already running, an
 * OpenAI-compatible API — a model of their choice beside the built-in one. It is the built-in sub-agent's loop
 * (`agent/subagents.ts`: the same calls answered by the one registry and the one policy in its conversation's mode,
 * its pause kept in its conversation's, its events under its `agentId`); only who answers changes. Each call to the
 * model goes through aparté's OpenAI-compatible adapter and its direct transport, the adapter serveOnService hands
 * aparté's handler — not that handler itself: a sub-agent's pause is its conversation's, answered by the core
 * across a restart, never a ticket of its own and a history the window sends again.
 *
 * It takes no slot: the conversation's memory is neither saved nor restored around it, and the built-in engine
 * may serve another conversation meanwhile. What it reads is disarmed for any family a service may run
 * (security rule 5), as a service turn's is. Its thread is its journal, beside the built-in sub-agents': its first
 * entry says the service and the model it runs on, so that a resume goes back there.
 */

import { join } from 'node:path';
import type { Verdict } from '@aparte/bonaparte-shared';
import { AparteDirectTransport, type AparteChatMessage, type AparteStreamEvent, type AparteTransport } from '@aparte/core';
import { createOpenAICompatProvider } from '@aparte/provider-openai-compat';
import type { SubagentTurnInput, TurnEvent, TurnResult, ModelCall } from '../conversation/engine.js';
import { withLastNote } from '../conversation/engine.js';
import { openJournal } from '../journal/journal.js';
import type { Journal, JournalEntry, Outcome, PendingCall, Usage } from '../journal/types.js';
import type { Provider } from '../providers/registry.js';
import type { ToolResult } from '../tools/types.js';
import { disarm, disarmDeep } from './endpoint.js';
import type { SubagentEngine } from './subagents.js';

/** Where a sub-agent runs on a service: the service (its id among the providers) and one of its models. */
export interface ServicePlace {
  engineId: string;
  model: string;
}

/** The setting « Moteur des sous-agents »: its conversation's engine, or a service and a model (`<id>/<model>`). */
export function readSubagentsEngine(value: unknown): ServicePlace | null {
  if (typeof value !== 'string' || value === 'conversation') return null;
  const at = value.indexOf('/');
  if (at <= 0 || at === value.length - 1) return null;
  return { engineId: value.slice(0, at), model: value.slice(at + 1) };
}

/** Its context on a service filled up: said as its own, with the model it ran on (audit S5). */
export class SubagentContextFullError extends Error {
  constructor(model: string) {
    super(
      `The sub-agent's own context on ${model} filled up, and what it found is lost. Give it a shorter mission that reads less, or do the work yourself.`,
    );
    this.name = 'SubagentContextFull';
  }
}

export interface ServiceSubagentsDeps {
  /** The conversations' folder: a sub-agent's journal is `<conversation>/agents/<agentId>`. */
  dir: string;
  /** The service of this id (an OpenAI-compatible one) and its key from the vault; undefined when it was removed. */
  service(engineId: string): Promise<{ provider: Provider; key: string | undefined } | undefined>;
  /** What the sub-agent reads before its note: its conversation's system prompt on a service (its folders, its instructions). */
  system(conversationId: string): Promise<string>;
  /** Who carries the calls (a test's); aparté's direct transport by default. */
  transport?: AparteTransport;
}

const engineOf = (entries: readonly JournalEntry[]): ServicePlace | null => {
  const first = entries.find((entry) => entry.kind === 'engine');
  return first?.kind === 'engine' && entries[0] === first ? { engineId: first.engineId, model: first.modelId } : null;
};

export class ServiceSubagents {
  private readonly transport: AparteTransport;

  constructor(private readonly deps: ServiceSubagentsDeps) {
    this.transport = deps.transport ?? new AparteDirectTransport({ byok: true });
  }

  private journal(conversationId: string, agentId: string): Promise<Journal> {
    return openJournal(join(this.deps.dir, conversationId, 'agents'), agentId);
  }

  /** A sub-agent's thread as it stands. */
  async entriesOf(conversationId: string, agentId: string): Promise<readonly JournalEntry[]> {
    return (await this.journal(conversationId, agentId)).entries();
  }

  /** The service a sub-agent runs on, as its journal says; null for one of the built-in engine (or not started). */
  async placeOf(conversationId: string, agentId: string): Promise<ServicePlace | null> {
    return engineOf((await this.journal(conversationId, agentId)).entries());
  }

  async subagentPaused(conversationId: string, agentId: string): Promise<Extract<JournalEntry, { kind: 'pending' }> | null> {
    const last = (await this.journal(conversationId, agentId)).entries().at(-1);
    return last?.kind === 'pending' ? last : null;
  }

  async recordSubagentAnswers(
    conversationId: string,
    agentId: string,
    answers: { outcomes: Record<string, Outcome>; results: readonly ToolResult[]; pending?: { calls: PendingCall[]; ticket: string } },
  ): Promise<void> {
    const journal = await this.journal(conversationId, agentId);
    await journal.append({ kind: 'outcomes', outcomes: answers.outcomes });
    if (answers.results.length > 0) await journal.append({ kind: 'tool-results', results: [...answers.results] });
    if (answers.pending) await journal.append({ kind: 'pending', calls: answers.pending.calls, ticket: answers.pending.ticket });
  }

  /**
   * Its turn: its first (its place, its note and its mission journaled), or its pause answered. The rounds go on
   * while the model calls tools and `onCalls` answers them; `answer` is the text of its last answer.
   */
  async subagentTurn(
    conversationId: string,
    agent: { agentId: string; name: string },
    input: SubagentTurnInput,
    sink: (event: TurnEvent) => void,
    options: { signal?: AbortSignal; place?: ServicePlace } = {},
  ): Promise<TurnResult & { answer: string }> {
    const journal = await this.journal(conversationId, agent.agentId);
    if (input.start && journal.entries().length === 0) {
      if (!options.place) throw new Error('A sub-agent on a service is started with its service and its model.');
      await journal.append({ kind: 'engine', engineId: options.place.engineId, modelId: options.place.model });
      await journal.append({ kind: 'delta', delta: { kind: 'note', text: `${await this.deps.system(conversationId)}\n\n${input.start.note}` } });
      await journal.append({ kind: 'user', text: input.start.mission });
    }
    const place = engineOf(journal.entries());
    if (!place) throw new Error(`The sub-agent ${agent.name} does not run on a service.`);
    const found = await this.deps.service(place.engineId);
    if (!found) throw new Error(`The service the sub-agent ran on (${place.engineId}) is no longer added.`);
    const { provider, key } = found;
    const adapter = createOpenAICompatProvider({
      id: provider.id,
      name: provider.label,
      baseURL: provider.url ?? '',
      isLocal: true,
      ...(provider.server && provider.server !== 'openai' ? { server: provider.server } : {}),
    });
    const tools = input.tools.defs.map((def) => ({ name: def.name, description: disarm(def.description), inputSchema: disarmDeep(def.inputSchema) }));
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let last: TurnResult['concluded'];
    const { signal } = options;
    for (let round = 0; ; round += 1) {
      if (round > 0) sink({ type: 'round' });
      let text = '';
      const calls: ModelCall[] = [];
      try {
        const response = await this.transport.chat(
          adapter,
          {
            modelId: place.model,
            messages: messagesOf(journal.entries()),
            stream: true,
            ...(tools.length > 0 ? { tools } : {}),
            // Its last answer calls nothing (audit S4, S5).
            ...(last ? { toolChoice: 'none' as const } : {}),
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          },
          key,
          { providerId: provider.id, ...(signal ? { signal } : {}) },
        );
        if (typeof response === 'string') text = response;
        else {
          const reader = response.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const event = value as AparteStreamEvent;
            if (event.type === 'text') {
              text += event.delta;
              sink({ type: 'text', delta: event.delta });
            } else if (event.type === 'thinking') sink({ type: 'thinking', delta: event.delta });
            else if (event.type === 'tool_use') calls.push({ id: event.id || `call-${calls.length}`, name: event.name, input: event.input ?? {} });
            else if (event.type === 'done' && event.usage) usage = { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens };
            else if (event.type === 'error') throw Object.assign(new Error(event.message), { code: event.code });
          }
        }
      } catch (error) {
        if (signal?.aborted) {
          await journal.append({ kind: 'assistant', raw: text, stopped: 'user' });
          return { usage, stopped: 'user', answer: text.trim() };
        }
        if ((error as { code?: unknown }).code === 'USAGE_CONTEXT_EXCEEDED') throw new SubagentContextFullError(place.model);
        await journal.append({ kind: 'assistant', raw: text, stopped: 'engine' });
        throw error;
      }
      await journal.append({ kind: 'assistant', raw: text, usage, ...(calls.length > 0 && !last ? { calls } : {}) });
      if (last) return { usage, concluded: last, answer: text.trim() };
      if (calls.length === 0) return { usage, answer: text.trim() };
      const answer = await input.tools.onCalls(calls);
      if ('stop' in answer) return { usage, limited: true, answer: lastText(journal.entries()) };
      if ('suspend' in answer) {
        const ran = answer.suspend.results ?? [];
        if (ran.length > 0) await journal.append({ kind: 'tool-results', results: ran });
        await journal.append({ kind: 'pending', calls: answer.suspend.pending, ticket: answer.suspend.ticket });
        return { usage, suspended: answer.suspend, answer: lastText(journal.entries()) };
      }
      // A service's context is not known: only its limit of rounds gives a last answer here; its overflow is said.
      const results = answer.last ? withLastNote(answer.results, answer.last.note) : answer.results;
      if (answer.last) last = { why: answer.last.why };
      await journal.append({ kind: 'tool-results', results });
    }
  }
}

function lastText(entries: readonly JournalEntry[]): string {
  const last = entries.findLast((entry) => entry.kind === 'assistant');
  return last?.kind === 'assistant' ? last.raw.trim() : '';
}

/**
 * The sub-agent's thread as the service reads it: its system text and note, its mission, its answers with their
 * calls, the results — every text from outside disarmed again. A call its thread left unanswered (a pause the
 * person left, a Stop) is answered as not run, so that every call has its result.
 */
export function messagesOf(entries: readonly JournalEntry[]): AparteChatMessage[] {
  const messages: AparteChatMessage[] = [];
  let open: string[] = [];
  const close = (): void => {
    for (const id of open) messages.push({ role: 'tool', toolCallId: id, content: 'Not run.' });
    open = [];
  };
  for (const entry of entries) {
    if (entry.kind === 'delta' && entry.delta.kind === 'note') messages.push({ role: messages.length === 0 ? 'system' : 'user', content: disarm(entry.delta.text) });
    else if (entry.kind === 'user') {
      close();
      messages.push({ role: 'user', content: disarm(entry.text) });
    } else if (entry.kind === 'assistant') {
      close();
      messages.push({
        role: 'assistant',
        content: disarm(entry.raw),
        ...(entry.calls?.length ? { toolCalls: entry.calls.map((one) => ({ id: one.id, name: one.name, input: disarmDeep(one.input) })) } : {}),
      });
      open = (entry.calls ?? []).map((one) => one.id);
    } else if (entry.kind === 'tool-results') {
      for (const result of entry.results) {
        messages.push({ role: 'tool', toolCallId: result.toolCallId, toolName: result.name, content: disarm(result.content) });
        open = open.filter((id) => id !== result.toolCallId);
      }
    }
  }
  return messages;
}

/**
 * The engine a turn's sub-agents run on: those started now on `fresh` (a service and a model) when it is given, else
 * on the built-in engine; each one resumed where its thread says it ran. On a service they take no slot — and run
 * one after another, as on one slot.
 */
export function routeSubagents(builtin: SubagentEngine, service: ServiceSubagents, fresh: ServicePlace | null): SubagentEngine {
  const where = async (conversationId: string, agentId: string): Promise<ServicePlace | 'builtin' | 'new'> => {
    const entries = (await service.entriesOf(conversationId, agentId)) ?? [];
    if (entries.length === 0) return 'new';
    return engineOf(entries) ?? 'builtin';
  };
  return {
    async subagentTurn(conversationId, agent, input, sink, options = {}) {
      const place = await where(conversationId, agent.agentId);
      const onService = place === 'new' ? fresh : place === 'builtin' ? null : place;
      if (!onService) return builtin.subagentTurn(conversationId, agent, input, sink, options);
      return service.subagentTurn(conversationId, agent, input, sink, { ...(options.signal ? { signal: options.signal } : {}), place: onService });
    },
    async subagentPaused(conversationId, agentId) {
      return (await service.placeOf(conversationId, agentId)) ? service.subagentPaused(conversationId, agentId) : builtin.subagentPaused(conversationId, agentId);
    },
    async recordSubagentAnswers(conversationId, agentId, answers) {
      return (await service.placeOf(conversationId, agentId))
        ? service.recordSubagentAnswers(conversationId, agentId, answers)
        : builtin.recordSubagentAnswers(conversationId, agentId, answers);
    },
    placeOf: (conversationId, agentId) => service.placeOf(conversationId, agentId),
    get slotCount() {
      return fresh ? 1 : (builtin.slotCount ?? 1);
    },
    get freeSlots() {
      return fresh ? 0 : (builtin.freeSlots ?? 0);
    },
  };
}

/** What a sub-agent of a service turn reads of a call its mode would ask (audit S3). Sent to the model: English. */
export const ASK_REFUSED =
  "This call needs the user's approval, which a sub-agent of a conversation on a service cannot wait for. Do not try again: " +
  'answer the main agent with what you found, and what is left for it to do (for a change: the path, and the change).';

/** The policy's verdict for such a sub-agent: what would be asked is refused, what passes passes — never more. */
export function askedAsRefused(verdict: Verdict): Verdict {
  return verdict.verdict === 'ask' ? { verdict: 'deny', reason: ASK_REFUSED } : verdict;
}
