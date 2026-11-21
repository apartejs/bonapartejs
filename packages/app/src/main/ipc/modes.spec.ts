/**
 * The mode of a conversation and the preview of a call, through the bridge.
 * The window reads the mode its conversation runs in (and whether Impro must
 * be confirmed again), sets it, and asks what a paused call would change:
 * the core decides, the window shows. Arguments are checked first.
 */

import { describe, expect, it } from 'vitest';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerModeChannels, type ModeCore } from './modes.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';

function setup() {
  const set: [string, string][] = [];
  const remembered: unknown[] = [];
  const core: ModeCore = {
    remembered: {
      offer: async () => ({ rule: { tool: 'run_command', program: 'pnpm', args: ['test'] }, where: 'project' }),
      remember: async (id, call, scope) => {
        remembered.push([id, call.name, scope]);
        return true;
      },
      rules: async (projectId) => (projectId ? [{ tool: 'run_command', program: 'pnpm', args: ['test'] }] : []),
      revoke: async (projectId, rule) => void remembered.push(['revoke', projectId, rule]),
    },
    modeOf: async () => ({ mode: 'plume', reconfirm: true }),
    setMode: async (id, mode) => void set.push([id, mode]),
    previewCall: async (_id, call) =>
      call.name === 'write_file' ? { kind: 'diff', path: 'a.ts', before: null, after: 'x\n', diff: '+x' } : null,
  };
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  registerModeChannels(createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') }), core);
  const call = (name: string, input: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, set, remembered };
}

describe('the mode channels', () => {
  it('give the mode a conversation runs in, and whether Impro must be confirmed again', async () => {
    await expect(setup().call('modes.get', { id: 'c-1' })).resolves.toEqual({ mode: 'plume', reconfirm: true });
  });

  it('set the mode of a conversation — one of the four, nothing else', async () => {
    const { call, set } = setup();
    await call('modes.set', { id: 'c-1', mode: 'impro' });
    expect(set).toEqual([['c-1', 'impro']]);
    await expect(call('modes.set', { id: 'c-1', mode: 'yolo' })).rejects.toThrow(/input/);
  });

  it('preview a call: what it would change, or nothing', async () => {
    const { call } = setup();
    await expect(call('tools.preview', { id: 'c-1', call: { name: 'write_file', input: { path: 'a.ts', content: 'x\n' } } })).resolves.toMatchObject({
      kind: 'diff',
      after: 'x\n',
    });
    await expect(call('tools.preview', { id: 'c-1', call: { name: 'read_file', input: {} } })).resolves.toBeNull();
  });

  it('« Toujours autoriser » (audit D3): the window names a call and a scope — never a rule to add', async () => {
    const { call, remembered } = setup();
    const named = { name: 'run_command', input: { program: 'pnpm', args: ['test'] } };
    await expect(call('permissions.offer', { id: 'c-1', call: named })).resolves.toEqual({ rule: { tool: 'run_command', program: 'pnpm', args: ['test'] }, where: 'project' });
    await expect(call('permissions.remember', { id: 'c-1', call: named, scope: 'always' })).resolves.toBe(true);
    await expect(call('permissions.remember', { id: 'c-1', call: named, scope: 'forever' })).rejects.toThrow(/input/);
    await expect(call('permissions.remember', { id: 'c-1', rule: { tool: 'run_command' }, scope: 'always' })).rejects.toThrow(/input/);
    const listed = (await call('permissions.rules', { projectId: 'p-1' })) as { key: string; rule: unknown }[];
    expect(listed.map((row) => row.rule)).toEqual([{ tool: 'run_command', program: 'pnpm', args: ['test'] }]);
    // Taken back by the name the list gave it; a name of nothing kept takes nothing back.
    await call('permissions.revoke', { projectId: 'p-1', key: listed[0]!.key });
    await call('permissions.revoke', { projectId: 'p-1', key: '["run_command","bash",[],null,null]' });
    await expect(call('permissions.revoke', { projectId: null, rule: { tool: 'web_search' } })).rejects.toThrow(/input/);
    expect(remembered).toEqual([['c-1', 'run_command', 'always'], ['revoke', 'p-1', { tool: 'run_command', program: 'pnpm', args: ['test'] }]]);
  });
});
