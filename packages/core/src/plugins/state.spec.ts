/**
 * What the app keeps of its plugins (task 11.1): those added, where each came from, and what is switched off —
 * for the whole app, or for one project. It survives a restart; a file that cannot be read is never written over.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginState } from './state.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-plugin-state-'));
  dirs.push(dir);
  await mkdir(join(dir, 'config'), { recursive: true });
  return join(dir, 'config', 'plugins.json');
}

describe('what the app keeps of its plugins (task 11.1)', () => {
  it('starts with everything on and nothing added', async () => {
    const state = await PluginState.open(await folder());
    expect(state.isOff('terminal')).toBe(false);
    expect(state.installed()).toEqual([]);
  });

  it('a plugin switched off for the app, or for a project only, stays so after a restart', async () => {
    const file = await folder();
    const state = await PluginState.open(file);
    await state.setOff('web-search', true);
    await state.setOff('browser', true, 'p1');
    const again = await PluginState.open(file);
    expect(again.isOff('web-search')).toBe(true);
    expect(again.isOff('web-search', 'p2')).toBe(true);
    expect(again.isOff('browser')).toBe(false);
    expect(again.isOff('browser', 'p1')).toBe(true);
    expect(again.offFor('p1')).toEqual(['browser']);
    await again.setOff('web-search', false);
    expect((await PluginState.open(file)).isOff('web-search')).toBe(false);
  });

  it('remembers where an added plugin came from, and an update found for it; forgotten, it leaves', async () => {
    const file = await folder();
    const state = await PluginState.open(file);
    await state.record('revue-pr', { kind: 'npm', name: 'revue-pr', version: '0.3.0' }, '2026-11-18T10:00:00.000Z');
    await state.setUpdate('revue-pr', '0.4.0');
    const again = await PluginState.open(file);
    expect(again.installed()).toEqual([
      { id: 'revue-pr', source: { kind: 'npm', name: 'revue-pr', version: '0.3.0' }, addedAt: '2026-11-18T10:00:00.000Z', update: '0.4.0' },
    ]);
    await again.forget('revue-pr');
    expect((await PluginState.open(file)).installed()).toEqual([]);
  });

  it('a file that cannot be read is said, and never written over', async () => {
    const file = await folder();
    await writeFile(file, '{ not json');
    const state = await PluginState.open(file);
    expect(state.error).toMatch(/cannot be read/);
    await expect(state.setOff('terminal', true)).rejects.toThrow(/cannot be read/);
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });
});
