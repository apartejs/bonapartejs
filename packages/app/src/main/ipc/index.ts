/**
 * Every channel the main process serves, registered in one place: the window
 * reaches the core through these and nothing else (task 5.1). The list is
 * the contract's (`CHANNELS`); a test checks they agree.
 */

import { appInfo, conversationsOpenFolder, conversationsShowPr, type Locale } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import { registerConversationChannels } from './conversations.js';
import { registerChangeChannels } from './changes.js';
import { registerEngineChannels } from './engine.js';
import { registerFileChannels } from './files.js';
import { registerPluginChannels } from './plugins.js';
import { registerModeChannels } from './modes.js';
import { registerProjectChannels, type ChooseFolder } from './projects.js';
import { searchQuery } from '@aparte/bonaparte-shared';
import { registerExportChannel, registerSettingsChannels } from './settings.js';
import { registerMemoryChannels, registerModelChannels } from './models.js';
import { registerProviderChannels } from './providers.js';
import { registerMcpChannels } from './mcp.js';
import { registerRunChannels } from './runs.js';
import { registerBrowserChannels } from './browser.js';
import type { BuiltinBrowser } from '../browser/service.js';
import type { IpcRegistry } from './register.js';

export interface AppFacts {
  version(): string;
  locale(): Locale;
  /** The system's folder dialog (or a test's folder). */
  chooseFolder: ChooseFolder;
  /** Opens the data folder in the system's file manager (in a test run, only notes it). */
  openDataFolder(): Promise<void>;
  /** Opens a folder the core named (a conversation's worktree) in the system's file manager. */
  openFolder(path: string): Promise<void>;
  /** Opens a page the core read (a pull request's, on GitHub) in the system's browser. */
  openLink(url: string): Promise<void>;
  /** A conversation was seen in the window (the notification area draws again). */
  seen?(): void;
  /** The built-in browser's pages (task 10.1): the pane's channels reach them. */
  browser?: BuiltinBrowser;
}

export function registerAllChannels(ipc: IpcRegistry, core: Core, facts: AppFacts): void {
  ipc.handle(appInfo, () => ({ version: facts.version(), locale: facts.locale() }));
  registerEngineChannels(ipc, core);
  registerMcpChannels(ipc, core);
  registerRunChannels(ipc, core);
  if (facts.browser) registerBrowserChannels(ipc, facts.browser);
  registerConversationChannels(ipc, core, facts.seen ? { seen: facts.seen } : {});
  ipc.handle(conversationsOpenFolder, async ({ id }) => {
    const branch = await core.branchOf(id);
    if (branch) await facts.openFolder(branch.worktree);
  });
  // Only a pull request's page on GitHub, as the core read it for this conversation.
  ipc.handle(conversationsShowPr, async ({ id }) => {
    const pr = await core.prOf(id);
    if (pr && /^https:\/\/github\.com\//.test(pr.url)) await facts.openLink(pr.url);
  });
  registerModeChannels(ipc, core);
  registerFileChannels(ipc, core);
  registerChangeChannels(ipc, core);
  registerPluginChannels(ipc, core);
  registerProjectChannels(ipc, core, facts.chooseFolder);
  ipc.handle(searchQuery, ({ query, conversationId, projectId }) =>
    core.search(query, { ...(conversationId ? { conversationId } : {}), ...(projectId ? { projectId } : {}) }),
  );
  registerSettingsChannels(ipc, core, facts.openDataFolder);
  registerExportChannel(ipc, core, facts.chooseFolder);
  registerModelChannels(ipc, core, facts.chooseFolder);
  registerMemoryChannels(ipc, core);
  registerProviderChannels(ipc, core);
}
