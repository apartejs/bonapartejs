/**
 * The settings through the bridge, and the export of the conversations
 * (task 5.9). The folder of an export is chosen in the system's dialog: the
 * window never names a path the main process writes to (security rule 1).
 */

import { conversationsExport, settingsGet } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { ChooseFolder } from './projects.js';
import type { IpcRegistry } from './register.js';

export type SettingsCore = { settings: Pick<Core['settings'], 'get'> };
export type ExportCore = Pick<Core, 'exportConversations'>;

export function registerSettingsChannels(ipc: IpcRegistry, core: SettingsCore): void {
  ipc.handle(settingsGet, ({ key }) => core.settings.get(key));
}

export function registerExportChannel(ipc: IpcRegistry, core: ExportCore, chooseFolder: ChooseFolder): void {
  ipc.handle(conversationsExport, async ({ labels }) => {
    const into = await chooseFolder();
    return into === null ? null : core.exportConversations(into, labels);
  });
}
