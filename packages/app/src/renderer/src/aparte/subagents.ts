/**
 * Sub-agents in the window (task 8.2, board « Une conversation avec des
 * sous-agents au travail »). aparté draws one line per sub-agent in the reply
 * (`setupSubagents`: its name, its task, its state, its step or its count —
 * « Attend le moteur » while it waits for the slot), and a view of its own
 * thread (`<aparte-subagent-view>`), opened from its line. What aparté does not
 * draw is the count of a reply's sub-agents (apartejs/aparte#247): the pane
 * says it, from the run's events as they come — this tracker.
 */

import { aparteGlobalConfig, type AparteConfig } from '@aparte/core';
import { botIcon } from '@aparte/core/icons';
import { setupSubagents, subagentOf, subagentStatus } from '@aparte/plugin-subagents';
import type { AparteMessage } from '@aparte/core';

export type SubagentState = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';

export interface SubagentRow {
  agentId: string;
  /** The reply it works for: what its view is opened on. */
  messageId: string;
  name: string;
  mission: string;
  /** What it was given: read only, or commands too; unknown for one read back from an older thread. */
  tools: 'read' | 'all' | null;
  state: SubagentState;
  /** Its calls so far. */
  calls: number;
  /** How long it has worked, in seconds, once it is done. */
  seconds: number | null;
  result?: string;
}

interface Tracked extends SubagentRow {
  startedAt: number;
  toolCallId?: string;
}

/** What a run event of a sub-agent looks like, as far as the pane reads it. */
interface RunEventLike {
  type: string;
  agentId?: string;
  name?: string;
  description?: string;
  toolCallId?: string;
  input?: unknown;
  status?: string;
  result?: string;
}

export interface SubagentTracker {
  observe(event: RunEventLike, where: { messageId: string; targetId?: string }, now?: number): void;
  /** The sub-agents of a chat, in the order they started; read back from its messages when none was heard. */
  rowsOf(chatId: string, messages?: () => readonly AparteMessage[]): SubagentRow[];
  subscribe(listener: () => void): () => void;
}

const ENDS: Record<string, SubagentState> = { done: 'done', failed: 'failed', stopped: 'stopped', waiting: 'waiting' };

export function createSubagentTracker(): SubagentTracker {
  const chats = new Map<string, Map<string, Tracked>>();
  // The input of each run_subagent call: what its sub-agent was given (read only, or commands too).
  const inputs = new Map<string, Record<string, unknown>>();
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const toolsOf = (input: Record<string, unknown> | undefined): SubagentRow['tools'] =>
    input ? (input['tools'] === 'all' ? 'all' : 'read') : null;

  return {
    observe(event, where, now = Date.now()) {
      if (event.type === 'tool-start' && event.name === 'run_subagent' && !event.agentId && event.toolCallId) {
        if (typeof event.input === 'object' && event.input !== null) inputs.set(event.toolCallId, event.input as Record<string, unknown>);
        return;
      }
      const agentId = event.agentId;
      if (!agentId) return;
      const chatId = where.targetId ?? '';
      let rows = chats.get(chatId);
      if (!rows) chats.set(chatId, (rows = new Map()));
      let row = rows.get(agentId);
      if (event.type === 'agent-start') {
        if (row) {
          // The same sub-agent goes on after a pause: its line stays.
          row.state = 'running';
          row.seconds = null;
        } else {
          const input = event.toolCallId ? inputs.get(event.toolCallId) : undefined;
          row = {
            agentId,
            messageId: where.messageId,
            name: event.name ?? '',
            mission: event.description ?? '',
            tools: toolsOf(input),
            state: 'running',
            calls: 0,
            seconds: null,
            startedAt: now,
            ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          };
          rows.set(agentId, row);
        }
        tell();
        return;
      }
      if (!row) return;
      switch (event.type) {
        case 'step-start':
          if (event.name === 'slot-wait') row.state = 'queued';
          break;
        case 'step-end':
          if (event.name === 'slot-wait' && row.state === 'queued') row.state = 'running';
          break;
        case 'tool-start':
          row.calls += 1;
          break;
        case 'tool-awaiting-approval':
          row.state = 'waiting';
          break;
        case 'tool-approved':
          if (row.state === 'waiting') row.state = 'running';
          break;
        case 'agent-end':
          row.state = ENDS[event.status ?? ''] ?? 'done';
          row.seconds = Math.max(0, Math.round((now - row.startedAt) / 1000));
          if (event.result) row.result = event.result;
          break;
        default:
          return;
      }
      tell();
    },

    rowsOf(chatId, messages) {
      const heard = chats.get(chatId);
      if (heard && heard.size > 0) return [...heard.values()].map(({ startedAt: _at, toolCallId: _call, ...row }) => ({ ...row }));
      return messages ? readBack(messages()) : [];
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The sub-agents of a thread read back from its messages: a conversation opened again, nothing heard yet. */
function readBack(messages: readonly AparteMessage[]): SubagentRow[] {
  const rows: SubagentRow[] = [];
  for (const message of messages) {
    for (const segment of message.segments ?? []) {
      const agent = subagentOf(segment);
      if (!agent) continue;
      const input = (segment as { toolCall?: { input?: unknown } }).toolCall?.input as Record<string, unknown> | undefined;
      const status = subagentStatus(segment);
      rows.push({
        agentId: agent.id,
        messageId: message.id,
        name: agent.name ?? '',
        mission: agent.description ?? '',
        tools: input ? (input['tools'] === 'all' ? 'all' : 'read') : null,
        state: status === 'running' ? 'running' : (ENDS[status] ?? 'done'),
        calls: (agent.segments ?? []).filter((one) => one.type === 'tool_call').length,
        seconds: null,
        ...(agent.result ? { result: agent.result } : {}),
      });
    }
  }
  return rows;
}

/** How many of them are in each state: the top of the pane. */
export function countOf(rows: readonly SubagentRow[]): Record<SubagentState | 'total', number> {
  const count = { total: rows.length, done: 0, running: 0, waiting: 0, queued: 0, failed: 0, stopped: 0 };
  for (const row of rows) count[row.state] += 1;
  return count;
}

/** aparté's lines of the sub-agents, and the tracker that hears their events: undone together. */
export function setupSubagentLines(tracker: SubagentTracker, config: AparteConfig = aparteGlobalConfig): () => void {
  const undoLines = setupSubagents({ activity: true, counts: true, details: 'transcript', open: 'event' }, config);
  // Its line wears the pane's icon; its name, its task and its state stay the plugin's.
  config.registerIcons({ bot: () => botIcon });
  config.registerToolDisplay('run_subagent', { icon: 'bot' });
  const stopHearing = config.observeRunEvents((event, where) =>
    tracker.observe(event as RunEventLike, { messageId: where.messageId, ...(where.targetId ? { targetId: where.targetId } : {}) }),
  );
  return () => {
    stopHearing();
    config.unregisterToolDisplay('run_subagent');
    undoLines();
  };
}
