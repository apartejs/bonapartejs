/**
 * The entry of the main process: a short bootstrap, then the app.
 *
 * It does two things that must come before everything else. It declares the
 * scheme the window lives on, which Electron only accepts before it is ready.
 * And, in a test run, it makes sure that nothing can put a window on the
 * person's screen — an error box included: the error is written to the
 * console and the process exits with a code.
 *
 * The app itself is imported after that, so that even a failure to load it
 * goes through these guards.
 */

import { app, dialog, protocol } from 'electron';
// Constants only: this file must load with nothing but Electron beside it.
import { APP_SCHEME } from '@aparte/bonaparte-shared/agent';

const e2e = process.env['BONAPARTE_E2E'] === '1';

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

function fail(error: unknown): void {
  console.error('[bonaparte] fatal:', error);
  if (!e2e) dialog.showErrorBox('bonaparte', error instanceof Error ? error.message : String(error));
  app.exit(1);
}

if (e2e) {
  dialog.showErrorBox = (title, content) => console.error(`[bonaparte] ${title}: ${content}`);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

import('./app.js').then(({ startApp }) => startApp({ e2e })).catch(fail);
