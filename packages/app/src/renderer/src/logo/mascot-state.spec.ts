/**
 * The mascot's state (task 12.2, board « Logo et ses états »): what a turn of the conversation shown is doing, read
 * from its stream, and what the engine does, make one of ten states — the most urgent first.
 */

import { describe, expect, it } from 'vitest';
import { activityOf, mascotState, type MascotInput } from './mascot-state';

const base: MascotInput = { engine: 'ready', activity: null, happyUntil: 0, now: 1_000, hovered: false };

describe('a turn’s stream, read as what it is doing', () => {
  it('reasoning, writing, reading again, waiting, failing, ending', () => {
    expect(activityOf({ type: 'thinking-delta', delta: 'hm' })).toBe('thinking');
    expect(activityOf({ type: 'text-delta', delta: 'Bon' })).toBe('writing');
    expect(activityOf({ type: 'step-start', name: 'reread' })).toBe('reading');
    expect(activityOf({ type: 'step-start', name: 'restore' })).toBe('reading');
    expect(activityOf({ type: 'step-start', name: 'seed' })).toBe('reading');
    expect(activityOf({ type: 'step-start', name: 'slot-wait' })).toBeNull();
    expect(activityOf({ type: 'tool-awaiting-approval', toolCallId: 't' })).toBe('waiting');
    expect(activityOf({ type: 'run-suspended' })).toBe('waiting');
    // The request answered, the turn works again.
    expect(activityOf({ type: 'tool-approved', toolCallId: 't' })).toBe('thinking');
    expect(activityOf({ type: 'tool-rejected', toolCallId: 't' })).toBe('thinking');
    expect(activityOf({ type: 'run-error' })).toBe('failed');
    expect(activityOf({ type: 'run-aborted' })).toBe('stopped');
    expect(activityOf({ type: 'run-done' })).toBe('done');
    // A sub-agent's text is still the turn writing.
    expect(activityOf({ type: 'text-delta', delta: 'x', agentId: 'agent-1' })).toBe('writing');
    expect(activityOf({ type: 'tool-start', toolCallId: 't', name: 'read_file' })).toBeNull();
  });
});

describe('the mascot’s state', () => {
  it('says each moment of a turn', () => {
    expect(mascotState({ ...base, activity: 'thinking' })).toBe('thinking');
    expect(mascotState({ ...base, activity: 'writing' })).toBe('talking');
    expect(mascotState({ ...base, activity: 'reading' })).toBe('reading');
    expect(mascotState({ ...base, activity: 'waiting' })).toBe('waiting');
    expect(mascotState({ ...base, activity: 'failed' })).toBe('error');
  });

  it('is content for 1.5 s after a turn that ends well, then rests', () => {
    expect(mascotState({ ...base, activity: 'done', happyUntil: 2_500, now: 1_000 })).toBe('happy');
    expect(mascotState({ ...base, activity: 'done', happyUntil: 2_500, now: 2_600 })).toBe('idle');
    expect(mascotState({ ...base, activity: 'stopped' })).toBe('idle');
  });

  it('sleeps while the model is unloaded, wakes while it loads, and shows an engine that stopped', () => {
    expect(mascotState({ ...base, engine: 'stopped' })).toBe('sleeping');
    expect(mascotState({ ...base, engine: 'starting' })).toBe('wake');
    expect(mascotState({ ...base, engine: 'restarting' })).toBe('wake');
    expect(mascotState({ ...base, engine: 'crashed' })).toBe('error');
    // No engine chosen yet (the first launch): nothing to sleep from.
    expect(mascotState({ ...base, engine: 'none' })).toBe('idle');
  });

  it('is surprised on hover, unless something more urgent is said', () => {
    expect(mascotState({ ...base, hovered: true })).toBe('surprised');
    expect(mascotState({ ...base, hovered: true, activity: 'waiting' })).toBe('waiting');
    expect(mascotState({ ...base, hovered: true, activity: 'failed' })).toBe('error');
  });

  it('puts the most urgent first: a failure, then a request, then the work, then the engine', () => {
    expect(mascotState({ ...base, engine: 'stopped', activity: 'waiting' })).toBe('waiting');
    expect(mascotState({ ...base, engine: 'starting', activity: 'reading' })).toBe('reading');
    expect(mascotState({ ...base, engine: 'crashed', activity: 'waiting' })).toBe('error');
  });
});
