/**
 * The entry of the main process: a short bootstrap, then the app.
 *
 * It does two things that must come before everything else. It declares the
 * scheme the window lives on, which Electron only accepts before it is ready.
 * And, in a test run, it makes sure that nothing can put a window on the
 * person's screen — an error box included: the error is written to the
 * console and the process exits with a code — that it stays off the
 * graphics card, and that a window opened by mistake is created out of sight.
 *
 * The app itself is imported after that, so that even a failure to load it
 * goes through these guards.
 */

import { app, dialog, protocol } from 'electron';
// Constants only: this file must load with nothing but Electron beside it.
import { APP_SCHEME, PLUGIN_SCHEME } from '@aparte/bonaparte-shared/agent';

const e2e = process.env['BONAPARTE_E2E'] === '1';

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
  // A plugin's view, in a sandboxed frame of its own origin (task 11.2): its scripts load as modules across.
  {
    scheme: PLUGIN_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function fail(error: unknown): void {
  console.error('[bonaparte] fatal:', error);
  if (!e2e) dialog.showErrorBox('bonaparte', error instanceof Error ? error.message : String(error));
  app.exit(1);
}

if (e2e) {
  dialog.showErrorBox = (title, content) => console.error(`[bonaparte] ${title}: ${content}`);
  // A test run draws for nobody: it leaves the graphics card to whatever the
  // person is doing. Chromium fixes this at startup, before the app is ready.
  app.disableHardwareAcceleration();
  // Nor may a window the app did not mean to open. The app refuses every
  // window a page asks for; should that refusal ever be lost, the window would
  // be created here, where nobody sees it — and a test can still count it.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        x: -32_000,
        y: -32_000,
        opacity: 0,
        skipTaskbar: true,
        focusable: false,
      },
    }));
  });
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

import('./app.js').then(({ startApp }) => startApp({ e2e })).catch(fail);
