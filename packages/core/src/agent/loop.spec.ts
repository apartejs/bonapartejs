/**
 * The agent's loop on the built-in engine: the calls the model writes are
 * decided by the one approval policy, run by the one registry, and said to
 * the page in aparté's events. A call allowed runs (tool-start, then
 * tool-resolved); a call refused is said (tool-rejected, by the policy) and
 * the model reads why; a call to ask about pauses the turn (tool-awaiting-
 * approval), the calls after it in the same step queued; the window's own
 * tools pause the turn for the window (external). Past its rounds, the turn
 * stops, and says so.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayMode } from '@aparte/bonaparte-shared';
import type { StreamRunEvent } from '@aparte/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallsAnswer, ModelCall, TurnInput, TurnResult } from '../conversation/engine.js';
import { PermissionEngine } from '../permissions/engine.js';
import { builtinTools } from '../tools/builtin/index.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolDef } from '../tools/types.js';
import { runAgentTurn, type AgentTurnContext } from './loop.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

/** A conversation engine whose model writes, round after round, the calls the test gives. */
function scripted(rounds: Omit<ModelCall, 'id'>[][]) {
  const answers: CallsAnswer[] = [];
  return {
    answers,
    conversations: {
      async turn(_id: string, input: TurnInput): Promise<TurnResult> {
        let n = 0;
        for (const calls of rounds) {
          const answer = await input.tools!.onCalls(calls.map((call) => ({ ...call, id: `call-${++n}` })));
          answers.push(answer);
          if ('stop' in answer) return { usage: { inputTokens: 1, outputTokens: 1 }, limited: true };
          if ('suspend' in answer) return { usage: { inputTokens: 1, outputTokens: 1 }, suspended: answer.suspend };
        }
        return { usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
  };
}

const ASK_USER: ToolDef = {
  name: 'ask_user',
  description: 'Ask the person.',
  inputSchema: {},
  effect: 'ui',
  source: 'builtin',
  where: 'window',
};

async function turn(rounds: Omit<ModelCall, 'id'>[][], mode: PlayMode, options: Partial<AgentTurnContext> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bp-loop-'));
  dirs.push(root);
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  const registry = new ToolRegistry();
  for (const tool of builtinTools()) registry.register(tool.def, tool.handler);
  const { conversations, answers } = scripted(rounds);
  const events: StreamRunEvent[] = [];
  const result = await runAgentTurn(
    {
      conversationId: 'c1',
      input: { text: 'Go' },
      mode,
      registry,
      permissions: new PermissionEngine({ roots: () => [root], dataDir: join(root, '..', 'bp-data') }),
      conversations,
      roots: [root],
      nCtx: 8_192,
      windowTools: [ASK_USER],
      ticket: (pending) => `ticket-${pending.length}`,
      signal: new AbortController().signal,
      ...options,
    },
    (event) => events.push(event),
    () => undefined,
  );
  return { result, events, answers, root };
}

const types = (events: StreamRunEvent[]) => events.map((event) => event.type);

describe('runAgentTurn', () => {
  it('a call allowed runs: tool-start, then tool-resolved, and the model reads its result', async () => {
    const { events, answers } = await turn([[{ name: 'read_file', input: { path: 'a.ts' } }]], 'repetition');
    expect(types(events)).toEqual(['tool-start', 'tool-resolved']);
    expect(events[1]).toMatchObject({ toolCallId: 'call-1', result: 'export const a = 1;\n' });
    expect(answers[0]).toEqual({
      results: [{ toolCallId: 'call-1', name: 'read_file', content: 'export const a = 1;\n', structuredContent: { lines: 1 } }],
    });
  });

  it('a call the policy refuses is said, and the model reads why', async () => {
    const { events, answers } = await turn([[{ name: 'edit_file', input: { path: 'a.ts', old_string: 'a', new_string: 'b' } }]], 'lecture');
    expect(types(events)).toEqual(['tool-start', 'tool-rejected']);
    expect(events[1]).toMatchObject({ by: 'policy', reason: expect.stringMatching(/Lecture mode/) });
    const answer = answers[0]!;
    expect('results' in answer ? answer.results[0] : null).toMatchObject({ failed: true, content: expect.stringMatching(/Lecture mode/) });
  });

  it('a call to ask about pauses the turn; the calls after it in the same step wait, queued', async () => {
    const { events, result } = await turn(
      [
        [
          { name: 'edit_file', input: { path: 'a.ts', old_string: 'a', new_string: 'b' } },
          { name: 'read_file', input: { path: 'a.ts' } },
        ],
      ],
      'repetition',
    );
    expect(types(events)).toEqual(['tool-start', 'tool-awaiting-approval', 'tool-start']);
    expect(events[2]).toMatchObject({ toolCallId: 'call-2', queued: true });
    expect(result.suspended).toEqual({
      pending: [
        { toolCallId: 'call-1', name: 'edit_file', input: { path: 'a.ts', old_string: 'a', new_string: 'b' }, reason: 'approval' },
        { toolCallId: 'call-2', name: 'read_file', input: { path: 'a.ts' }, reason: 'queued' },
      ],
      ticket: 'ticket-2',
      results: [],
    });
  });

  it('the calls that ran before a pause keep their results', async () => {
    const { result } = await turn(
      [
        [
          { name: 'read_file', input: { path: 'a.ts' } },
          { name: 'run_command', input: { program: 'pnpm', args: ['test'] } },
        ],
      ],
      'repetition',
    );
    expect(result.suspended?.results).toEqual([
      { toolCallId: 'call-1', name: 'read_file', content: 'export const a = 1;\n', structuredContent: { lines: 1 } },
    ]);
    expect(result.suspended?.pending).toEqual([
      { toolCallId: 'call-2', name: 'run_command', input: { program: 'pnpm', args: ['test'] }, reason: 'approval' },
    ]);
  });

  it("a tool of the window pauses the turn for the window: external", async () => {
    const { events, result } = await turn([[{ name: 'ask_user', input: { question: 'Which one?' } }]], 'impro');
    expect(types(events)).toEqual(['tool-start']);
    expect(result.suspended?.pending).toEqual([{ toolCallId: 'call-1', name: 'ask_user', input: { question: 'Which one?' }, reason: 'external' }]);
  });

  it('a tool nobody has fails, and the model reads which', async () => {
    const { events } = await turn([[{ name: 'rm_rf', input: {} }]], 'impro');
    expect(types(events)).toEqual(['tool-start', 'tool-failed']);
    expect(events[1]).toMatchObject({ error: expect.stringMatching(/no tool named rm_rf/i) });
  });

  it('past its rounds, the turn stops, and says so', async () => {
    const read = [{ name: 'read_file', input: { path: 'a.ts' } }];
    const { events, result } = await turn([read, read, read, read], 'impro', { maxToolRounds: 3 });
    expect(events.filter((event) => event.type === 'turn-limit-exceeded')).toEqual([{ type: 'turn-limit-exceeded', scope: 'global', limit: 3 }]);
    expect(result.limited).toBe(true);
  });
});
