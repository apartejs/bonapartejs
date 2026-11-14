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
import { isTrustedOrigin } from './security.js';
import { createMainWindow } from './windows.js';

/** The language of the interface: French on a French system, English otherwise. */
function interfaceLocale(): Locale {
  const forced = process.env['BONAPARTE_LOCALE'];
  if (forced === 'fr' || forced === 'en') return forced;
  return app.getLocale().toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export async function startApp(options: { e2e: boolean }): Promise<void> {
  // Set by electron-vite in development: the dev server that serves the window.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'] || undefined;

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
