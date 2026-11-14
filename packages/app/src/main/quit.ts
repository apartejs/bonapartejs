/**
 * A llama-server the app launched does not outlive it: quitting waits until
 * the engine is stopped (its whole tree), then quits for real. On Windows a
 * child dies with the app anyway (libuv's job object); elsewhere the server is
 * detached, to be stopped as a group, and would outlive an app that forgot it.
 */

import type { App } from 'electron';

export function stopEngineBeforeQuit(
  app: Pick<App, 'on' | 'quit'>,
  core: { stop(): Promise<void> },
  log: (message: string, error: unknown) => void = console.error,
): void {
  let stopping: Promise<void> | undefined;
  let stopped = false;
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    // Asked twice while the engine stops: one stop, one quit.
    stopping ??= core
      .stop()
      .catch((error: unknown) => log('[bonaparte] the engine did not stop:', error))
      .finally(() => {
        stopped = true;
        app.quit();
      });
  });
}
