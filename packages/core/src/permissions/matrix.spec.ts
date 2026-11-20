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
  ['browser_open', 'network', ['ask', 'ask', 'ask', 'allow']],
  ['browser_open_file', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['browser_read', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['browser_screenshot', 'read', ['allow', 'allow', 'allow', 'allow']],
  ['browser_act', 'execute', ['deny', 'ask', 'ask', 'allow']],
  ['web_fetch', 'network', ['ask', 'ask', 'ask', 'allow']],
  ['web_search', 'network', ['ask', 'ask', 'ask', 'allow']],
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

  it('going online is allowed in every mode once « ask before the network » is off — Impro never asks for it (Paul, 2026-11-20)', () => {
    const relaxed = new PermissionEngine({
      roots: () => [project],
      dataDir: join(project, '..', 'bonaparte-data'),
      askBeforeNetwork: () => false,
    });
    const got = MODES.map((mode) => relaxed.evaluate({ tool: tool('web_fetch', 'network'), input: {}, mode }).verdict);
    expect(got).toEqual(['allow', 'allow', 'allow', 'allow']);
  });

  it('an ask says why: the mode, or the network', () => {
    expect(engine().evaluate({ tool: tool('edit_file', 'write'), input: input('edit_file'), mode: 'repetition' })).toEqual({
      verdict: 'ask',
      why: 'mode',
    });
    expect(engine().evaluate({ tool: tool('web_fetch', 'network'), input: {}, mode: 'plume' })).toEqual({ verdict: 'ask', why: 'network' });
  });

  it('a refusal says why, in English, for the model', () => {
    const refused = engine().evaluate({ tool: tool('edit_file', 'write'), input: input('edit_file'), mode: 'lecture' });
    expect(refused.verdict).toBe('deny');
    expect(refused.verdict === 'deny' ? refused.reason : '').toMatch(/Lecture mode/);
    // A small model plans only when the tool is named (a lesson of v0).
    expect(refused.verdict === 'deny' ? refused.reason : '').toContain('update_plan');
    const run = engine().evaluate({ tool: tool('run_command', 'execute'), input: input('run_command'), mode: 'lecture' });
    expect(run.verdict === 'deny' ? run.reason : '').toContain('update_plan');
  });
});

describe('a discussion has the whole built-in browser; one browser_open for a page or a file (Paul, 2026-11-20)', () => {
  const plugin = (name: string, effect: ToolEffect): ToolDef => ({ ...tool(name, effect), source: 'plugin' });
  const dataDir = () => join(project, '..', 'bonaparte-data');

  it('acting on a page is asked each time in a discussion — never refused by its Lecture, never let through by a rule', () => {
    const remembered = () => [{ tool: 'browser_act' }];
    const discussion = new PermissionEngine({ roots: () => [], dataDir: dataDir(), rules: remembered }).forDiscussion();
    const act = { tool: plugin('browser_act', 'execute'), input: { action: 'click', selector: 'a' } };
    for (const mode of MODES) expect(discussion.evaluate({ ...act, mode })).toEqual({ verdict: 'ask', why: 'mode' });
    // A code conversation in Lecture runs nothing, its act included.
    expect(new PermissionEngine({ roots: () => [project], dataDir: dataDir() }).evaluate({ ...act, mode: 'lecture' }).verdict).toBe('deny');
    // Reading and picturing its page pass; opening one is the network, asked as « ask before the network » says.
    expect(discussion.evaluate({ tool: plugin('browser_read', 'read'), input: {}, mode: 'lecture' })).toEqual({ verdict: 'allow' });
    expect(discussion.evaluate({ tool: plugin('browser_open', 'network'), input: { url: 'https://example.com' }, mode: 'lecture' })).toEqual({
      verdict: 'ask',
      why: 'network',
    });
    const relaxed = new PermissionEngine({ roots: () => [], dataDir: dataDir(), askBeforeNetwork: () => false }).forDiscussion();
    expect(relaxed.evaluate({ tool: plugin('browser_open', 'network'), input: { url: 'https://example.com' }, mode: 'lecture' })).toEqual({ verdict: 'allow' });
  });

  it('browser_open of a file of the project is a read, of an address the network', () => {
    const engine = new PermissionEngine({ roots: () => [project], dataDir: dataDir() });
    const open = plugin('browser_open', 'network');
    expect(engine.evaluate({ tool: open, input: { path: 'bac/snake.html' }, mode: 'lecture' })).toEqual({ verdict: 'allow' });
    expect(engine.evaluate({ tool: open, input: { url: 'file:///C:/projet/a.html' }, mode: 'lecture' })).toEqual({ verdict: 'allow' });
    expect(engine.evaluate({ tool: open, input: { url: 'http://localhost:5173' }, mode: 'lecture' })).toEqual({ verdict: 'ask', why: 'network' });
    // Another plugin's tool of the same name is judged by what it declares.
    expect(engine.evaluate({ tool: { ...open, source: 'extension' }, input: { path: 'a.html' }, mode: 'repetition' }).verdict).toBe('ask');
  });
});
