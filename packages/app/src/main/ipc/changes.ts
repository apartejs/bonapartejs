/**
 * The « Changements » channels: glue. The core puts back only a file the
 * conversation changed; any other path does nothing.
 */

import type { Core } from '@aparte/bonaparte-core';
import { changesList, changesRevert } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export function registerChangeChannels(ipc: IpcRegistry, core: Pick<Core, 'changes'>): void {
  ipc.handle(changesList, ({ id }) => core.changes.list(id));
  ipc.handle(changesRevert, ({ id, path }) => core.changes.revert(id, path));
}
