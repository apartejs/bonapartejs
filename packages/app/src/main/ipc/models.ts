/**
 * Where models are looked for, through the bridge (Settings, Models — task
 * 5.7): a folder is added from the system's dialog, never named by the
 * window; the search of the whole disk is started, followed and cancelled.
 */

import {
  engineMemory,
  engineReleaseMemory,
  engineDiskCheck,
  engineResources,
  engineRestart,
  engineUnload,
  modelsAddFolder,
  modelsScanCancel,
  modelsScanDisk,
  modelsScanState,
} from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { ChooseFolder } from './projects.js';
import type { IpcRegistry } from './register.js';

export type ModelsCore = Pick<Core, 'addModelFolder'> & { diskScan: Pick<Core['diskScan'], 'start' | 'state' | 'cancel'> };
export type MemoryCore = Pick<Core, 'memory' | 'releaseMemory' | 'diskCheck' | 'unloadModel' | 'restartEngine' | 'resources'>;

export function registerModelChannels(
  ipc: IpcRegistry,
  core: ModelsCore,
  chooseFolder: ChooseFolder,
  /** A folder added: its models are found now, and the window reads them again — the composer's picker among them. */
  modelsChanged?: () => void,
): void {
  ipc.handle(modelsAddFolder, async () => {
    const folder = await chooseFolder();
    if (folder === null) return null;
    const folders = await core.addModelFolder(folder);
    modelsChanged?.();
    return folders;
  });
  ipc.handle(modelsScanDisk, () => {
    core.diskScan.start();
    return core.diskScan.state();
  });
  ipc.handle(modelsScanState, () => core.diskScan.state());
  ipc.handle(modelsScanCancel, () => {
    core.diskScan.cancel();
    return core.diskScan.state();
  });
}

/** « Moteur et mémoire »: the overview, a memory let go, the model unloaded or restarted. */
export function registerMemoryChannels(ipc: IpcRegistry, core: MemoryCore): void {
  ipc.handle(engineMemory, () => core.memory());
  ipc.handle(engineReleaseMemory, ({ id }) => core.releaseMemory(id));
  ipc.handle(engineDiskCheck, ({ id }) => core.diskCheck(id));
  ipc.handle(engineResources, () => core.resources.last());
  ipc.handle(engineUnload, () => core.unloadModel());
  ipc.handle(engineRestart, () => core.restartEngine());
}
