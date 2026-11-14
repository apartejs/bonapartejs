/**
 * Quitting waits for the engine to stop. On Windows a child the app launched
 * dies with it anyway (libuv puts it in a job object), but on Linux and macOS
 * the server is launched detached, to be stopped as a group, and would
 * outlive an app that forgot it — holding its video memory.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { stopEngineBeforeQuit } from './quit.js';

function fakeApp() {
  const emitter = new EventEmitter();
  const quit = vi.fn();
  /** Raises `before-quit` as Electron does; says whether the quit was held back. */
  const beforeQuit = (): boolean => {
    let held = false;
    emitter.emit('before-quit', { preventDefault: () => (held = true) });
    return held;
  };
  return { app: { on: emitter.on.bind(emitter), quit } as never, quit, beforeQuit };
}

describe('stopEngineBeforeQuit', () => {
  it('holds the quit until the engine is stopped, then quits', async () => {
    const { app, quit, beforeQuit } = fakeApp();
    let stopped!: () => void;
    const stop = vi.fn(() => new Promise<void>((resolve) => (stopped = resolve)));
    stopEngineBeforeQuit(app, { stop });

    expect(beforeQuit()).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    stopped();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    // The second time round, the engine is stopped: nothing holds the quit.
    expect(beforeQuit()).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('quits even when the engine does not stop, and says so', async () => {
    const { app, quit, beforeQuit } = fakeApp();
    const log = vi.fn();
    stopEngineBeforeQuit(app, { stop: () => Promise.reject(new Error('taskkill failed')) }, log);

    expect(beforeQuit()).toBe(true);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith(expect.stringContaining('did not stop'), expect.any(Error));
  });

  it('stops the engine once, however many times the person asks to quit', async () => {
    const { app, beforeQuit } = fakeApp();
    const stop = vi.fn(() => new Promise<void>(() => undefined));
    stopEngineBeforeQuit(app, { stop });

    expect(beforeQuit()).toBe(true);
    expect(beforeQuit()).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });
});
