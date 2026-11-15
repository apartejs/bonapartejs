/**
 * The « Fichiers » channels: glue. The core resolves every path inside the
 * conversation's perimeter, and refuses the rest.
 */

import type { Core } from '@aparte/bonaparte-core';
import { filesChanged, filesList, filesRead } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export function registerFileChannels(ipc: IpcRegistry, core: Pick<Core, 'files'>): void {
  ipc.handle(filesList, ({ scope, dir }) => core.files.list(scope, dir));
  ipc.handle(filesRead, ({ scope, path }) => core.files.read(scope, path));
  ipc.handle(filesChanged, ({ id }) => core.files.changed(id));
}
