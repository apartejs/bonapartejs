/**
 * What the conversation engine says while it works, in aparté's words: its
 * text, its reasoning, its steps (the slot it waits for, a restore, a seed, a
 * re-read, a compaction the context made necessary), the bar of a re-read,
 * and the line a compaction leaves in the answer. A sub-agent's say the same, under its
 * `agentId` (task 8.1): aparté draws them on its line, never in the reply.
 */

import type { StreamRunEvent } from '@aparte/engine';
import type { TurnEvent } from '../conversation/engine.js';

export function turnEventToWire(event: TurnEvent, rereading: { on: boolean }, agentId?: string): StreamRunEvent[] {
  if (event.type === 'compaction') {
    // The conversation compacted on its own (audit 2026-11-21, D2): its step while it runs, then a line in the
    // answer that stays — what it held before and after.
    const mine = agentId ? { agentId } : {};
    if (event.phase === 'start') return [{ type: 'step-start', name: 'compact', ...mine }];
    const done: StreamRunEvent[] = [{ type: 'step-end', name: 'compact', ...mine }];
    if (event.before !== undefined && event.after !== undefined) {
      done.push({
        type: 'activity',
        id: `compaction-${Date.now()}`,
        activityType: 'compaction',
        content: { before: event.before, after: event.after },
        ...mine,
      });
    }
    return done;
  }
  const one = turnEventToLine(event, rereading, agentId);
  if (event.type === 'round') {
    // The text of the round before is flushed first: aparté's parser holds a text that ends on a backtick or on half a
    // tag until more comes, and a turn-start drops what it holds (aparté's own runner flushes at each call's end too).
    return [{ type: 'text-flush', ...(agentId ? { agentId } : {}) } as StreamRunEvent, ...(one ? [one] : [])];
  }
  return one ? [one] : [];
}

function turnEventToLine(event: TurnEvent, rereading: { on: boolean }, agentId?: string): StreamRunEvent | null {
  const mine = agentId ? { agentId } : {};
  switch (event.type) {
    case 'text':
      return { type: 'text-delta', delta: event.delta, ...mine };
    case 'thinking':
      return { type: 'thinking-delta', delta: event.delta, ...mine };
    case 'round':
      // aparté starts its blocks afresh only on a turn-start: one per call to the model, a sub-agent's under its id.
      return { type: 'turn-start', ...mine };
    case 'step':
      if (event.name === 'reread') rereading.on = event.phase === 'start';
      return { type: event.phase === 'start' ? 'step-start' : 'step-end', name: event.name, ...mine };
    case 'progress':
      // The progress of a prompt read again: the bar of the `reread` activity.
      return rereading.on
        ? {
            type: 'activity',
            id: agentId ? `reread-${agentId}` : 'reread',
            activityType: 'reread',
            content: { done: event.done, total: event.total },
            ...mine,
          }
        : null;
    default:
      // A tool call: the loop says it, as it decides it (tool-start).
      return null;
  }
}
