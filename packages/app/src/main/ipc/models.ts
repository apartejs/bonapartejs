/**
 * Where models are looked for, through the bridge (Settings, Models — task
 * 5.7): a folder is added from the system's dialog, never named by the
 * window; the search of the whole disk is started, followed and cancelled.
 */

import { modelsAddFolder, modelsScanCancel, modelsScanDisk, modelsScanState } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { ChooseFolder } from './projects.js';
import type { IpcRegistry } from './register.js';

export type ModelsCore = Pick<Core, 'addModelFolder'> & { diskScan: Pick<Core['diskScan'], 'start' | 'state' | 'cancel'> };

export function registerModelChannels(ipc: IpcRegistry, core: ModelsCore, chooseFolder: ChooseFolder): void {
  ipc.handle(modelsAddFolder, async () => {
    const folder = await chooseFolder();
    return folder === null ? null : core.addModelFolder(folder);
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
