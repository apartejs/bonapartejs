/**
 * The projects through the bridge: what a folder says, the projects, a folder
 * chosen in the system's dialog. Arguments are checked first — a project has
 * a name and at least one folder, a mode among the four.
 */

import { describe, expect, it } from 'vitest';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerProjectChannels, type ProjectCore } from './projects.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';

const PROJECT = { id: 'p-1', name: 'spanwise', roots: ['C:/dev/spanwise'], defaultMode: 'plume' as const, createdAt: 'a', updatedAt: 'b' };

function setup(chosen: string | null = 'C:/dev/spanwise') {
  const created: unknown[] = [];
  const core: ProjectCore = {
    projects: {
      detect: async (folder) => ({ name: folder.split('/').pop()!, git: { branch: 'main' }, packageManager: 'pnpm', scripts: ['dev'], instructions: 'AGENTS.md', services: [] }),
      list: async () => [PROJECT],
      get: async () => PROJECT,
      create: async (input) => {
        created.push(input);
        return { ...PROJECT, ...input, roots: [...(input.roots ?? [])] };
      },
      update: async (_id, changes) => ({ ...PROJECT, ...changes, roots: [...(changes.roots ?? PROJECT.roots)] }),
      remove: async () => undefined,
    },
  };
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  registerProjectChannels(createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') }), core, async () => chosen);
  const call = (name: string, input?: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, created };
}

describe('the project channels', () => {
  it('say what a folder holds, before anything is made of it', async () => {
    await expect(setup().call('projects.detect', { folder: 'C:/dev/spanwise' })).resolves.toMatchObject({ name: 'spanwise', packageManager: 'pnpm' });
  });

  it("give the folder the person chose in the system's dialog — or nothing when they closed it", async () => {
    await expect(setup().call('projects.chooseFolder')).resolves.toEqual({ folder: 'C:/dev/spanwise' });
    await expect(setup(null).call('projects.chooseFolder')).resolves.toBeNull();
  });

  it('make a project with a name, its folders and a mode — and refuse one without a folder or a mode of its own', async () => {
    const { call, created } = setup();
    await expect(call('projects.create', { name: 'spanwise', roots: ['C:/dev/spanwise'], defaultMode: 'plume' })).resolves.toMatchObject({ id: 'p-1' });
    expect(created).toEqual([{ name: 'spanwise', roots: ['C:/dev/spanwise'], defaultMode: 'plume' }]);
    await expect(call('projects.create', { name: 'x', roots: [], defaultMode: 'plume' })).rejects.toThrow(/input/);
    await expect(call('projects.create', { name: 'x', roots: ['C:/x'], defaultMode: 'yolo' })).rejects.toThrow(/input/);
    await expect(call('projects.create', { name: '  ', roots: ['C:/x'], defaultMode: 'plume' })).rejects.toThrow(/input/);
  });

  it('list, change and remove the projects', async () => {
    const { call } = setup();
    await expect(call('projects.list')).resolves.toEqual([PROJECT]);
    await expect(call('projects.update', { id: 'p-1', changes: { defaultMode: 'lecture' } })).resolves.toMatchObject({ defaultMode: 'lecture' });
    await expect(call('projects.remove', { id: 'p-1' })).resolves.toBeUndefined();
  });
});
