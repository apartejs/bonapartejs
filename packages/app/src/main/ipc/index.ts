/**
 * Every channel the main process serves, registered in one place: the window
 * reaches the core through these and nothing else (task 5.1). The list is
 * the contract's (`CHANNELS`); a test checks they agree.
 */

import { appInfo, type Locale } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import { registerConversationChannels } from './conversations.js';
import { registerEngineChannels } from './engine.js';
import { registerModeChannels } from './modes.js';
import type { IpcRegistry } from './register.js';

export interface AppFacts {
  version(): string;
  locale(): Locale;
}

export function registerAllChannels(ipc: IpcRegistry, core: Core, facts: AppFacts): void {
  ipc.handle(appInfo, () => ({ version: facts.version(), locale: facts.locale() }));
  registerEngineChannels(ipc, core);
  registerConversationChannels(ipc, core);
  registerModeChannels(ipc, core);
}
