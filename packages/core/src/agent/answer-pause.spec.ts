/**
 * Answering a pause runs what the person allowed — unless the turn was
 * stopped meanwhile: then nothing runs, and each call is answered as not
 * run, for the model to read.
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StreamRunEvent } from '@aparte/engine';
import { describe, expect, it } from 'vitest';
import { PermissionEngine } from '../permissions/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import { answerPause, type Pause } from './resume.js';

describe('answerPause — after Stop', () => {
  it('an approved call does not run once the turn is stopped', async () => {
    const registry = new ToolRegistry();
    let touched = 0;
    registry.register(
      { name: 'touch_test', description: 'Touch.', inputSchema: {}, effect: 'write', source: 'builtin', where: 'core' },
      async () => {
        touched += 1;
        return { content: 'touched' };
      },
    );
    const stopped = new AbortController();
    stopped.abort();
    const pause = {
      kind: 'pending',
      id: 'e1',
      at: '',
      ticket: 't',
      calls: [{ toolCallId: 'c1', name: 'touch_test', input: {}, reason: 'approval' }],
    } as unknown as Pause;
    const events: StreamRunEvent[] = [];
    const { results } = await answerPause(
      {
        conversationId: 'c',
        mode: 'repetition',
        registry,
        permissions: new PermissionEngine({ roots: () => [], dataDir: join(tmpdir(), 'bp-none') }),
        roots: [],
        nCtx: 8_192,
        signal: stopped.signal,
      },
      pause,
      { c1: { kind: 'decision', approved: true } },
      (event) => events.push(event),
    );
    expect(touched).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['tool-aborted']);
    expect(results[0]).toMatchObject({ toolCallId: 'c1', failed: true, content: expect.stringMatching(/stopped/) });
  });
});
