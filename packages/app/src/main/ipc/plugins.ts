/**
 * The plugins' channels: a view's command to its plugin's Node half (with the project of the conversation shown),
 * its acknowledgement of what it has shown, and the Plugins page (task 11.3) — read a plugin before anything of it
 * runs, add it switched on or off, switch one on or off for the app or a project, remove it, ask for updates. Glue:
 * the core decides; the window hears that the plugins changed and reads them again.
 */

import type { Core } from '@aparte/bonaparte-core';
import {
  pluginsAck,
  pluginsCheckUpdates,
  pluginsDiscard,
  pluginsInstall,
  pluginsInvoke,
  pluginsOverview,
  pluginsPickFolder,
  pluginsPreview,
  pluginsRemove,
  pluginsSetEnabled,
  searchKeysList,
  searchKeysSet,
} from '@aparte/bonaparte-shared';
import type { ChooseFolder } from './projects.js';
import type { IpcRegistry } from './register.js';

export function registerPluginChannels(
  ipc: IpcRegistry,
  core: Pick<Core, 'plugins' | 'addedPlugins' | 'searchKeys'>,
  options: { chooseFolder?: ChooseFolder; changed?: () => void } = {},
): void {
  const changed = (): void => options.changed?.();
  const statuses = (projectId?: string) => core.plugins.status(projectId);
  ipc.handle(pluginsInvoke, ({ pluginId, action, payload, projectId }) => core.plugins.invoke(pluginId, action, payload, projectId ? { projectId } : {}));
  ipc.handle(pluginsAck, ({ pluginId, instanceId, chars }) => core.plugins.acknowledge(pluginId, instanceId, chars));
  ipc.handle(pluginsOverview, ({ projectId }) => statuses(projectId));
  ipc.handle(pluginsPreview, async (request) => {
    const read = await core.addedPlugins.preview(request);
    return read.ok ? { ok: true as const, preview: { ...read.preview, manifest: read.preview.manifest as unknown as Record<string, unknown> } } : read;
  });
  ipc.handle(pluginsInstall, async ({ stagingId, enable }) => {
    await core.addedPlugins.install(stagingId, { enable });
    changed();
    return statuses();
  });
  ipc.handle(pluginsDiscard, ({ stagingId }) => core.addedPlugins.discard(stagingId));
  ipc.handle(pluginsSetEnabled, async ({ id, enabled, projectId }) => {
    await core.plugins.setEnabled(id, enabled, projectId ? { projectId } : {});
    changed();
    return statuses(projectId);
  });
  ipc.handle(pluginsRemove, async ({ id }) => {
    await core.addedPlugins.remove(id);
    changed();
    return statuses();
  });
  ipc.handle(pluginsCheckUpdates, async () => {
    await core.addedPlugins.checkUpdates();
    changed();
    return statuses();
  });
  ipc.handle(pluginsPickFolder, async () => ({ path: (await options.chooseFolder?.()) ?? null }));
  ipc.handle(searchKeysList, () => core.searchKeys.list());
  ipc.handle(searchKeysSet, ({ provider, key }) => core.searchKeys.set(provider, key));
}
