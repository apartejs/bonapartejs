/**
 * The main process is glue: it builds the core, serves the window's scheme,
 * registers the IPC channels and opens the window. Nothing here decides
 * anything about a conversation.
 */

import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { bonaparteDataDir, createAgentHandler, createCore } from '@aparte/bonaparte-core';
import { appInfo, type Locale } from '@aparte/bonaparte-shared';
import { registerAppProtocol } from './agent-protocol.js';
import { createIpcRegistry } from './ipc/register.js';
import { devServerUrlFrom, isTrustedOrigin } from './security.js';
import { createMainWindow } from './windows.js';

/** The language of the interface: French on a French system, English otherwise. */
function interfaceLocale(): Locale {
  const forced = process.env['BONAPARTE_LOCALE'];
  if (forced === 'fr' || forced === 'en') return forced;
  return app.getLocale().toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export async function startApp(options: { e2e: boolean }): Promise<void> {
  // In development, the dev server that serves the window; never in a packaged app.
  const devServerUrl = devServerUrlFrom(process.env, app.isPackaged);

  await app.whenReady();

  const core = createCore({ dataDir: bonaparteDataDir() });
  registerAppProtocol({
    handler: createAgentHandler(core),
    rendererDir: join(import.meta.dirname, '..', 'renderer'),
    devServerUrl,
  });

  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => isTrustedOrigin(url, devServerUrl) });
  ipc.handle(appInfo, () => ({ version: app.getVersion(), locale: interfaceLocale() }));

  createMainWindow({ devServerUrl, e2e: options.e2e });

  app.on('window-all-closed', () => app.quit());
}
