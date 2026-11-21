/**
 * « Toujours autoriser » through the core (audit 2026-11-21, D3): the card
 * asks what may be remembered for a call, as its turn judges it; remembered
 * for its conversation, a rule answers that conversation alone and goes with
 * it; remembered always, it is kept across a restart, listed, and taken back.
 * A shell is never remembered; a third party's tool neither.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';

let dirs: string[] = [];
let cores: Core[] = [];
afterEach(async () => {
  await Promise.all(cores.map((core) => core.stop().catch(() => undefined)));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  dirs = [];
  cores = [];
});

async function setup(dir?: string): Promise<{ core: Core; dir: string }> {
  const data = dir ?? (await mkdtemp(join(tmpdir(), 'bp-remembered-')));
  if (!dir) dirs.push(data);
  const core = createCore({ dataDir: data, env: {}, logger: () => undefined, home: data });
  cores.push(core);
  return { core, dir: data };
}

const RUN = { name: 'run_command', input: { program: 'node', args: ['--version'] } };

function judge(core: Core, conversationId: string, call: { name: string; input: unknown }) {
  return core.permissions.evaluate({ tool: core.tools.get(call.name)!.def, input: call.input, mode: 'repetition', conversationId });
}

describe('« Toujours autoriser » through the core (audit D3)', () => {
  it('offers the exact command; remembered for its conversation, it answers that conversation alone, and goes with it', async () => {
    const { core } = await setup();
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    expect(judge(core, 'c1', RUN)).toEqual({ verdict: 'ask', why: 'mode' });
    expect(await core.remembered.offer('c1', RUN)).toEqual({ rule: { tool: 'run_command', program: 'node', args: ['--version'] }, where: 'app' });

    expect(await core.remembered.remember('c1', RUN, 'conversation')).toBe(true);
    expect(judge(core, 'c1', RUN)).toEqual({ verdict: 'allow' });
    expect(judge(core, 'c2', RUN)).toEqual({ verdict: 'ask', why: 'mode' });
    // Another argument is another command.
    expect(judge(core, 'c1', { name: 'run_command', input: { program: 'node', args: ['--eval', 'x'] } })).toEqual({ verdict: 'ask', why: 'mode' });
    // Not one of the app's rules: it is listed nowhere, and goes with its conversation.
    expect(await core.remembered.rules(null)).toEqual([]);
    await core.removeConversation('c1');
    expect(judge(core, 'c1', RUN)).toEqual({ verdict: 'ask', why: 'mode' });
  });

  it('remembered always: kept across a restart, listed, taken back', async () => {
    const { core, dir } = await setup();
    expect(await core.remembered.remember('c1', RUN, 'always')).toBe(true);
    const again = (await setup(dir)).core;
    expect(await again.remembered.rules(null)).toEqual([{ tool: 'run_command', program: 'node', args: ['--version'] }]);
    expect(judge(again, 'c9', RUN)).toEqual({ verdict: 'allow' });
    await again.remembered.revoke(null, { tool: 'run_command', program: 'node', args: ['--version'] });
    expect(await again.remembered.rules(null)).toEqual([]);
    expect(judge(again, 'c9', RUN)).toEqual({ verdict: 'ask', why: 'mode' });
  });

  it('never a shell, nor a chain: said why, and nothing remembered', async () => {
    const { core } = await setup();
    const shell = { name: 'run_command', input: { program: 'powershell', args: ['-Command', 'Get-ChildItem'] } };
    expect(await core.remembered.offer('c1', shell)).toEqual({ never: 'shell' });
    expect(await core.remembered.remember('c1', shell, 'always')).toBe(false);
    const chain = { name: 'run_command', input: { program: 'git', args: ['status', '&&', 'git', 'push'] } };
    expect(await core.remembered.offer('c1', chain)).toEqual({ never: 'chain' });
    expect(await core.remembered.rules(null)).toEqual([]);
  });

  it('nothing to offer for a call that does not ask, nor for a tool the core does not know', async () => {
    const { core } = await setup();
    expect(await core.remembered.offer('c1', { name: 'read_file', input: { path: 'a.txt' } })).toBeNull();
    expect(await core.remembered.offer('c1', { name: 'no_such_tool', input: {} })).toBeNull();
  });
});
