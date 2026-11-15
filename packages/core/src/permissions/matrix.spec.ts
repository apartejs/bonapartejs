/**
 * The matrix of the design document (§9): for each tool and each of the four
 * modes, the verdict. Lecture reads only (and plans); Répétition asks before
 * every change; Plume lets edits pass and asks for commands; Impro asks only
 * what is always asked. Going online asks in every mode while « ask before
 * the network » is on — the default.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayMode, ToolEffect } from '@aparte/bonaparte-shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import { PermissionEngine } from './engine.js';

type Short = 'allow' | 'ask' | 'deny';
const MODES: PlayMode[] = ['lecture', 'repetition', 'plume', 'impro'];

const MATRIX: [tool: string, effect: ToolEffect, expected: [Short, Short, Short, Short]][] = [
  ['read_file', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['list_files', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['search', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['edit_file', 'write', ['deny', 'ask', 'allow', 'allow']],
  ['write_file', 'write', ['deny', 'ask', 'allow', 'allow']],
  ['run_command', 'execute', ['deny', 'ask', 'ask', 'allow']],
  ['browser_open', 'network', ['ask', 'ask', 'ask', 'ask']],
  ['browser_read', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['browser_screenshot', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['browser_act', 'execute', ['deny', 'ask', 'ask', 'allow']],
  ['web_fetch', 'network', ['ask', 'ask', 'ask', 'ask']],
  ['web_search', 'network', ['ask', 'ask', 'ask', 'ask']],
  ['ask_user', 'ui', ['allow', 'allow', 'allow', 'allow']],
  ['update_plan', 'ui', ['allow', 'allow', 'allow', 'allow']],
];

let project: string;
beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'bp-matrix-'));
});
afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

function tool(name: string, effect: ToolEffect): ToolDef {
  return { name, description: name, inputSchema: {}, effect, source: 'builtin', where: 'core' };
}

function input(name: string): unknown {
  if (name === 'run_command') return { program: 'pnpm', args: ['test'] };
  if (name === 'edit_file' || name === 'write_file') return { path: 'src/index.ts', content: 'x' };
  return { path: 'src/index.ts', url: 'https://example.com' };
}

describe('the matrix of the design document', () => {
  // Built in each test: the project's folder exists only once the tests run.
  const engine = () => new PermissionEngine({ roots: () => [project], dataDir: join(project, '..', 'bonaparte-data') });
  for (const [name, effect, expected] of MATRIX) {
    it(`${name} (${effect}): ${expected.join(', ')}`, () => {
      const got = MODES.map((mode) => engine().evaluate({ tool: tool(name, effect), input: input(name), mode }).verdict);
      expect(got).toEqual(expected);
    });
  }

  it('going online is allowed in Impro once « ask before the network » is off — still asked in the other three', () => {
    const relaxed = new PermissionEngine({
      roots: () => [project],
      dataDir: join(project, '..', 'bonaparte-data'),
      askBeforeNetwork: () => false,
    });
    const got = MODES.map((mode) => relaxed.evaluate({ tool: tool('web_fetch', 'network'), input: {}, mode }).verdict);
    expect(got).toEqual(['ask', 'ask', 'ask', 'allow']);
  });

  it('an ask says why: the mode, or the network', () => {
    expect(engine().evaluate({ tool: tool('edit_file', 'write'), input: input('edit_file'), mode: 'repetition' })).toEqual({
      verdict: 'ask',
      why: 'mode',
    });
    expect(engine().evaluate({ tool: tool('web_fetch', 'network'), input: {}, mode: 'impro' })).toEqual({ verdict: 'ask', why: 'network' });
  });

  it('a refusal says why, in English, for the model', () => {
    const refused = engine().evaluate({ tool: tool('edit_file', 'write'), input: input('edit_file'), mode: 'lecture' });
    expect(refused.verdict).toBe('deny');
    expect(refused.verdict === 'deny' ? refused.reason : '').toMatch(/Lecture mode/);
  });
});
