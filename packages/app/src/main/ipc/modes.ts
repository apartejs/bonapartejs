/**
 * The mode channels: the mode a conversation runs in, set by the person, and
 * the preview of a call it paused on. Glue: the core decides.
 */

import type { Core } from '@aparte/bonaparte-core';
import { modesGet, modesSet, toolsPreview } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export type ModeCore = Pick<Core, 'modeOf' | 'setMode' | 'previewCall'>;

export function registerModeChannels(ipc: IpcRegistry, core: ModeCore): void {
  ipc.handle(modesGet, ({ id }) => core.modeOf(id));
  ipc.handle(modesSet, ({ id, mode }) => core.setMode(id, mode));
  ipc.handle(toolsPreview, ({ id, call }) => core.previewCall(id, call));
}
