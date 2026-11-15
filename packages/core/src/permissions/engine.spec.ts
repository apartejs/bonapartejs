/**
 * What the modes do not change (design document §9, security rules 3 and 9):
 * a file that runs later always asks, in every mode; a write outside the
 * project asks even in Impro; a tool that does not say what it does is taken
 * as one that runs something; a rule remembered turns an ask into an allow,
 * never a refusal into one, and never answers for a file that runs later;
 * the most permissive mode does not survive a restart unconfirmed.
 */

import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayMode, ToolEffect } from '@aparte/bonaparte-shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import { isArmedPath, modeAfterRestart, PermissionEngine, type PermissionEngineDeps } from './engine.js';
import type { AllowRule } from './rules.js';

let project: string;
let data: string;
beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'bp-permissions-'));
  data = await mkdtemp(join(tmpdir(), 'bp-permissions-data-'));
});
afterAll(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
});

function tool(name: string, effect: ToolEffect | undefined): ToolDef {
  return { name, description: name, inputSchema: {}, effect: effect as ToolEffect, source: 'builtin', where: 'core' };
}

const EDIT = tool('edit_file', 'write');
const RUN = tool('run_command', 'execute');

function engine(overrides: Partial<PermissionEngineDeps> = {}): PermissionEngine {
  return new PermissionEngine({ roots: () => [project], dataDir: data, ...overrides });
}

const edit = (path: string, mode: PlayMode) => engine().evaluate({ tool: EDIT, input: { path, old_string: 'a', new_string: 'b' }, mode });

describe('a file that runs later asks in every mode — and is refused in Lecture, like any write', () => {
  const ARMED = [
    'package.json',
    '.env',
    '.env.local',
    '.git/hooks/pre-commit',
    '.husky/pre-push',
    'vite.config.ts',
    'eslint.config.mjs',
    'tsconfig.config.json',
    'docker.config.yaml',
    'webpack.config.babel.js',
    'vite.config.local.ts',
    '.github/workflows/ci.yml',
    '.npmrc',
    'Makefile',
  ];
  for (const path of ARMED) {
    it(path, () => {
      expect(edit(path, 'plume')).toEqual({ verdict: 'ask', why: 'armed-path' });
      expect(edit(path, 'impro')).toEqual({ verdict: 'ask', why: 'armed-path' });
      expect(edit(path, 'lecture').verdict).toBe('deny');
    });
  }

  it('an ordinary file passes in Plume', () => {
    for (const path of ['src/index.ts', 'README.md', 'docs/config.md', 'src/package.ts', 'configure.ts']) {
      expect(edit(path, 'plume')).toEqual({ verdict: 'allow' });
    }
  });

  it("bonaparte's own data is armed: its settings, its rules, its servers are commands run later", () => {
    const outsideless = engine({ roots: () => [] , home: join(data, '..') });
    expect(isArmedPath(join(data, 'config', 'global.json'), data)).toBe(true);
    expect(isArmedPath(`${data}-notes/x.md`, data)).toBe(false);
    expect(outsideless.evaluate({ tool: EDIT, input: { path: join(data, 'grants.json') }, mode: 'impro' })).toEqual({
      verdict: 'ask',
      why: 'armed-path',
    });
  });

  it('a project can add its own: « always asked »', () => {
    const strict = engine({ alwaysAsk: () => ['Dockerfile'] });
    expect(strict.evaluate({ tool: EDIT, input: { path: 'Dockerfile' }, mode: 'plume' })).toEqual({ verdict: 'ask', why: 'armed-path' });
  });
});

describe('outside the project', () => {
  it('a write asks, even in Impro', () => {
    expect(edit('../elsewhere.txt', 'impro')).toEqual({ verdict: 'ask', why: 'outside-project' });
    expect(edit('../elsewhere.txt', 'plume')).toEqual({ verdict: 'ask', why: 'outside-project' });
  });

  it('without a project, a write outside the home folder is refused outright: never the whole machine', () => {
    const home = join(project, 'home');
    const homeOnly = engine({ roots: () => [], home });
    const outside = homeOnly.evaluate({ tool: EDIT, input: { path: join(project, 'elsewhere.txt') }, mode: 'impro' });
    expect(outside.verdict).toBe('deny');
    expect(outside.verdict === 'deny' ? outside.reason : '').toMatch(/outside the home folder/);
    expect(homeOnly.evaluate({ tool: EDIT, input: { path: 'notes.txt' }, mode: 'plume' })).toEqual({ verdict: 'allow' });
  });

  it('a write outside the project is judged where it really lands: through a link into .ssh, it is armed', async () => {
    const ssh = join(project, '..', `bp-home-${Date.now()}`, '.ssh');
    await mkdir(ssh, { recursive: true });
    try {
      await symlink(ssh, join(project, '..', `bp-keys-${process.pid}`), 'junction');
    } catch {
      return;
    }
    expect(edit(`../bp-keys-${process.pid}/authorized_keys`, 'impro')).toEqual({ verdict: 'ask', why: 'armed-path' });
  });

  it('a network path is refused outright', () => {
    expect(edit('\\\\server\\share\\x.txt', 'impro').verdict).toBe('deny');
  });
});

describe('a tool that does not say what it does', () => {
  it('is taken as one that runs something, and says so when it asks', () => {
    const vague = tool('mcp__weather__forecast', undefined);
    expect(engine().evaluate({ tool: vague, input: {}, mode: 'lecture' }).verdict).toBe('deny');
    expect(engine().evaluate({ tool: vague, input: {}, mode: 'plume' })).toEqual({ verdict: 'ask', why: 'undeclared-effect' });
    expect(engine().evaluate({ tool: vague, input: {}, mode: 'impro' })).toEqual({ verdict: 'allow' });
  });
});

describe('the rules remembered', () => {
  const rules = (list: AllowRule[]) => engine({ rules: () => list });

  it('turn an ask into an allow — that command, that program only', () => {
    const remembered = rules([{ tool: 'run_command', program: 'pnpm', args: ['test'] }]);
    expect(remembered.evaluate({ tool: RUN, input: { program: 'pnpm', args: ['test'] }, mode: 'repetition' })).toEqual({ verdict: 'allow' });
    expect(remembered.evaluate({ tool: RUN, input: { program: 'pnpm', args: ['build'] }, mode: 'repetition' }).verdict).toBe('ask');
  });

  it('never turn a refusal into an allow', () => {
    const remembered = rules([{ tool: 'run_command', program: 'pnpm' }]);
    expect(remembered.evaluate({ tool: RUN, input: { program: 'pnpm', args: ['test'] }, mode: 'lecture' }).verdict).toBe('deny');
  });

  it('never answer for a file that runs later, nor for one outside the project', () => {
    const remembered = rules([{ tool: 'edit_file' }]);
    expect(remembered.evaluate({ tool: EDIT, input: { path: 'package.json' }, mode: 'repetition' })).toEqual({
      verdict: 'ask',
      why: 'armed-path',
    });
    expect(remembered.evaluate({ tool: EDIT, input: { path: '../x.txt' }, mode: 'repetition' })).toEqual({
      verdict: 'ask',
      why: 'outside-project',
    });
    expect(remembered.evaluate({ tool: EDIT, input: { path: 'src/a.ts' }, mode: 'repetition' })).toEqual({ verdict: 'allow' });
  });

  it('a rule read from disk that could not have been remembered answers nothing', () => {
    const forged = rules([{ tool: 'run_command', program: 'bash' }]);
    expect(forged.evaluate({ tool: RUN, input: { program: 'bash', args: ['-c', 'ls'] }, mode: 'repetition' }).verdict).toBe('ask');
  });
});

describe('after a restart', () => {
  it('a conversation on its own branch is judged in its worktree, and never writes its project’s own folder', () => {
    const worktree = join(project, '.bonaparte', 'worktrees', 'heures');
    const judge = (path: string, mode: PlayMode) =>
      engine().evaluate({ tool: EDIT, input: { path, old_string: 'a', new_string: 'b' }, mode, roots: [worktree], barred: [project] });
    expect(judge('src/a.ts', 'plume')).toEqual({ verdict: 'allow' });
    expect(judge(join(worktree, 'src', 'a.ts'), 'plume')).toEqual({ verdict: 'allow' });
    const refused = judge(join(project, 'src', 'a.ts'), 'impro');
    expect(refused.verdict).toBe('deny');
    expect(refused.verdict === 'deny' && refused.reason).toContain(worktree);
    // Out of both: asked, as anywhere outside.
    expect(judge(join(tmpdir(), 'elsewhere.txt'), 'impro')).toEqual({ verdict: 'ask', why: 'outside-project' });
  });

  it('Impro is not kept without a new confirmation; the other modes are', () => {
    expect(modeAfterRestart('impro')).toBe('plume');
    for (const mode of ['lecture', 'repetition', 'plume'] as const) expect(modeAfterRestart(mode)).toBe(mode);
  });
});
