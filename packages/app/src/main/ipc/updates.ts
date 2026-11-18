/**
 * « Mises à jour » through the bridge (task 13.1): the core's llama.cpp and
 * models, the main process's app — each with its cost, nothing installed
 * under a reply.
 */

import { updatesKeep, updatesList, updatesLlama, updatesModel, updatesRestart, type UpdatesView } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { AppUpdates } from '../updater.js';
import type { IpcRegistry } from './register.js';

export type UpdatesCore = Pick<Core, 'updates' | 'updateLlamaCpp' | 'updateModel' | 'keepModel'>;

export async function readUpdates(core: UpdatesCore, app: AppUpdates | null, current: string, check: boolean): Promise<UpdatesView> {
  const [view, offer] = await Promise.all([core.updates({ check }), app ? (check ? app.check() : Promise.resolve(app.state())) : Promise.resolve(null)]);
  return { current, app: offer, llama: view.llama, models: view.models, busy: view.busy };
}

export function registerUpdateChannels(
  ipc: IpcRegistry,
  core: UpdatesCore,
  app: AppUpdates | null,
  current: () => string,
  changed: () => void = () => undefined,
): void {
  ipc.handle(updatesList, ({ check }) => readUpdates(core, app, current(), check));
  ipc.handle(updatesRestart, async () => {
    await app?.restart();
  });
  ipc.handle(updatesLlama, async () => {
    try {
      await core.updateLlamaCpp();
    } finally {
      changed();
    }
  });
  ipc.handle(updatesModel, async ({ id }) => {
    try {
      await core.updateModel(id);
    } finally {
      changed();
    }
  });
  ipc.handle(updatesKeep, async ({ id }) => {
    await core.keepModel(id);
    changed();
  });
}
