/**
 * The sub-agents of a conversation, for its pane (task 8.2): what each one is
 * doing, read from the run's events as they come — running, waiting for the
 * slot (« en file »), waiting for the person, then done, failed or stopped —
 * and the count the pane says at its top (aparté draws no summary of a
 * reply's sub-agents: apartejs/aparte#247).
 */

import { describe, expect, it } from 'vitest';
import { createSubagentTracker, countOf } from './subagents';

const CHAT = { messageId: 'm1', targetId: 'chat-1' };

function events(tracker: ReturnType<typeof createSubagentTracker>, list: Record<string, unknown>[], at = 1_000) {
  for (const [index, event] of list.entries()) tracker.observe(event as never, CHAT, at + index * 1_000);
}

describe('createSubagentTracker', () => {
  it('follows each sub-agent from its start to its end: its state, its calls, how long it took', () => {
    const tracker = createSubagentTracker();
    events(tracker, [
      { type: 'tool-start', toolCallId: 'c1', name: 'run_subagent', input: { name: 'Lecteur', mission: 'Lis les logs.', tools: 'read' } },
      { type: 'agent-start', agentId: 'a1', name: 'Lecteur', description: 'Lis les logs.', toolCallId: 'c1' },
      { type: 'tool-start', toolCallId: 'x1', name: 'read_file', input: {}, agentId: 'a1' },
      { type: 'tool-resolved', toolCallId: 'x1', result: 'ok', agentId: 'a1' },
      { type: 'agent-end', agentId: 'a1', status: 'done', result: 'Trouvé.' },
    ]);
    expect(tracker.rowsOf('chat-1')).toEqual([
      expect.objectContaining({ agentId: 'a1', messageId: 'm1', name: 'Lecteur', mission: 'Lis les logs.', tools: 'read', state: 'done', calls: 1, seconds: 3, result: 'Trouvé.' }),
    ]);
  });

  it('one that waits for the slot is « en file » until it gets it; one that asks waits for the person', () => {
    const tracker = createSubagentTracker();
    events(tracker, [
      { type: 'agent-start', agentId: 'a1', name: 'Un', description: 'Piste un.', toolCallId: 'c1' },
      { type: 'agent-start', agentId: 'a2', name: 'Deux', description: 'Piste deux.', toolCallId: 'c2' },
      { type: 'step-start', name: 'slot-wait', agentId: 'a2' },
      { type: 'tool-start', toolCallId: 'x1', name: 'edit_file', input: {}, agentId: 'a1' },
      { type: 'tool-awaiting-approval', toolCallId: 'x1', name: 'edit_file', input: {}, agentId: 'a1' },
    ]);
    expect(tracker.rowsOf('chat-1').map((row) => [row.name, row.state])).toEqual([
      ['Un', 'waiting'],
      ['Deux', 'queued'],
    ]);
    expect(countOf(tracker.rowsOf('chat-1'))).toEqual({ total: 2, done: 0, running: 0, waiting: 1, queued: 1, failed: 0, stopped: 0 });
    events(tracker, [
      { type: 'tool-approved', toolCallId: 'x1', agentId: 'a1' },
      { type: 'agent-end', agentId: 'a1', status: 'done' },
      { type: 'step-end', name: 'slot-wait', agentId: 'a2' },
    ]);
    expect(tracker.rowsOf('chat-1').map((row) => [row.name, row.state])).toEqual([
      ['Un', 'done'],
      ['Deux', 'running'],
    ]);
  });

  it('a sub-agent that resumes after a pause keeps its line: the same id goes on', () => {
    const tracker = createSubagentTracker();
    events(tracker, [
      { type: 'agent-start', agentId: 'a1', name: 'Rédacteur', description: 'Change a.', toolCallId: 'c1' },
      { type: 'agent-end', agentId: 'a1', status: 'waiting' },
      { type: 'agent-start', agentId: 'a1', name: 'Rédacteur', description: 'Change a.', toolCallId: 'c1' },
    ]);
    expect(tracker.rowsOf('chat-1')).toHaveLength(1);
    expect(tracker.rowsOf('chat-1')[0]!.state).toBe('running');
  });

  it('keeps each chat apart, and tells its listeners', () => {
    const tracker = createSubagentTracker();
    let heard = 0;
    tracker.subscribe(() => (heard += 1));
    tracker.observe({ type: 'agent-start', agentId: 'a1', name: 'Un', toolCallId: 'c1' } as never, CHAT, 0);
    tracker.observe({ type: 'agent-start', agentId: 'b1', name: 'Autre', toolCallId: 'c9' } as never, { messageId: 'm9', targetId: 'chat-2' }, 0);
    expect(tracker.rowsOf('chat-1').map((row) => row.agentId)).toEqual(['a1']);
    expect(tracker.rowsOf('chat-2').map((row) => row.agentId)).toEqual(['b1']);
    expect(heard).toBe(2);
    // An event of the reply itself, not of a sub-agent: nothing to tell.
    tracker.observe({ type: 'text-delta', delta: 'Bonjour' } as never, CHAT, 0);
    expect(heard).toBe(2);
  });
});
