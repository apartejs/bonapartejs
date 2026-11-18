/**
 * The plugins' channels: a view's command to its plugin's Node half, and its
 * acknowledgement of what it has shown. Glue: the core's host checks the
 * plugin, and turns off a plugin's commands for a project that turned it off.
 */

import type { Core } from '@aparte/bonaparte-core';
import { pluginsAck, pluginsInvoke, pluginsOverview } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export function registerPluginChannels(ipc: IpcRegistry, core: Pick<Core, 'plugins'>): void {
  ipc.handle(pluginsInvoke, ({ pluginId, action, payload, projectId }) => core.plugins.invoke(pluginId, action, payload, projectId ? { projectId } : {}));
  ipc.handle(pluginsOverview, ({ projectId }) => core.plugins.status(projectId));
  ipc.handle(pluginsAck, ({ pluginId, instanceId, chars }) => core.plugins.acknowledge(pluginId, instanceId, chars));
}
