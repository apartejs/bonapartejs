/**
 * What a project runs (task 10.3): the core reads the project of the conversation or the project named, and
 * launches; the window only asks.
 */

import type { Core } from '@aparte/bonaparte-core';
import { runsList, runsStart, runsStop } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export function registerRunChannels(ipc: IpcRegistry, core: Pick<Core, 'runs'>): void {
  const scopeOf = (input: { conversationId?: string | undefined; projectId?: string | undefined }) => ({
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
  ipc.handle(runsList, (input) => core.runs.list(scopeOf(input)));
  ipc.handle(runsStart, (input) => core.runs.start(scopeOf(input), input.kind, input.name));
  ipc.handle(runsStop, (input) => core.runs.stop(scopeOf(input), input.name));
}
