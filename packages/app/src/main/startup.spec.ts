/**
 * How the app starts and ends (task 5.9): one app per data folder — a second
 * launch brings the first one's window back and quits —; closing the window
 * hides it while « close to the tray » says so, and quitting closes it for
 * real; « launch at login » is written to the system only by an installed app,
 * never by a test run.
 */

import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLaunchAtLogin, claimSingleInstance, hideOnClose, revealWindow, windowProfile } from './startup.js';

function fakeApp(locked = true) {
  const emitter = new EventEmitter();
  const paths: Record<string, string> = {};
  let quit = 0;
  return {
    emitter,
    paths,
    quits: () => quit,
    app: {
      setPath: (name: string, path: string) => void (paths[name] = path),
      requestSingleInstanceLock: () => locked,
      quit: () => void (quit += 1),
      on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener as (...args: unknown[]) => void),
    },
  };
}

function fakeWindow() {
  const emitter = new EventEmitter();
  const calls: string[] = [];
  let minimized = false;
  let visible = true;
  return {
    emitter,
    calls,
    minimize: () => void (minimized = true),
    window: {
      on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener as (...args: unknown[]) => void),
      hide: () => {
        visible = false;
        calls.push('hide');
      },
      show: () => {
        visible = true;
        calls.push('show');
      },
      showInactive: () => {
        visible = true;
        calls.push('showInactive');
      },
      focus: () => calls.push('focus'),
      restore: () => {
        minimized = false;
        calls.push('restore');
      },
      isMinimized: () => minimized,
      isVisible: () => visible,
    },
  };
}

/** Raises `close` as Electron does; says whether the close was held back. */
function close(window: ReturnType<typeof fakeWindow>): boolean {
  let held = false;
  window.emitter.emit('close', { preventDefault: () => (held = true) });
  return held;
}

describe('one app per data folder', () => {
  it('keeps the window profile, and so the lock, in the data folder', () => {
    const fake = fakeApp();
    expect(windowProfile('C:/data/bonaparte')).toBe(join('C:/data/bonaparte', 'window'));
    expect(claimSingleInstance(fake.app, windowProfile('C:/data/bonaparte'), () => undefined)).toBe(true);
    expect(fake.paths['userData']).toBe(join('C:/data/bonaparte', 'window'));
    expect(fake.quits()).toBe(0);
  });

  it('a second launch quits, and the first one brings its window back', () => {
    const second = fakeApp(false);
    expect(claimSingleInstance(second.app, 'C:/data/bonaparte', () => undefined)).toBe(false);
    expect(second.quits()).toBe(1);

    const first = fakeApp(true);
    let revealed = 0;
    claimSingleInstance(first.app, 'C:/data/bonaparte', () => void (revealed += 1));
    first.emitter.emit('second-instance');
    expect(revealed).toBe(1);
  });
});

describe('closing the window', () => {
  it('hides it while « close to the tray » says so', () => {
    const fake = fakeApp();
    const window = fakeWindow();
    hideOnClose(fake.app, window.window, () => true);
    expect(close(window)).toBe(true);
    expect(window.calls).toEqual(['hide']);
  });

  it('closes it when the setting is off', () => {
    const fake = fakeApp();
    const window = fakeWindow();
    hideOnClose(fake.app, window.window, () => false);
    expect(close(window)).toBe(false);
    expect(window.calls).toEqual([]);
  });

  it('closes it when the app quits, or when Windows ends the session', () => {
    const quitting = fakeApp();
    const one = fakeWindow();
    hideOnClose(quitting.app, one.window, () => true);
    quitting.emitter.emit('before-quit', { preventDefault: () => undefined });
    expect(close(one)).toBe(false);

    const ending = fakeApp();
    const two = fakeWindow();
    hideOnClose(ending.app, two.window, () => true);
    two.emitter.emit('session-end');
    expect(close(two)).toBe(false);
  });
});

describe('bringing the window back', () => {
  it('in front of the person: shown, restored, focused', () => {
    const window = fakeWindow();
    window.window.hide();
    window.minimize();
    window.calls.length = 0;
    revealWindow(window.window, false);
    expect(window.calls).toEqual(['restore', 'show', 'focus']);
  });

  it('in a test run: shown without being activated, never in front', () => {
    const window = fakeWindow();
    window.window.hide();
    window.calls.length = 0;
    revealWindow(window.window, true);
    expect(window.calls).toEqual(['showInactive']);
  });
});

describe('launch at login', () => {
  it('is written to the system by an installed app', () => {
    const written: unknown[] = [];
    expect(applyLaunchAtLogin(true, { packaged: true, e2e: false, setLoginItem: (settings) => written.push(settings) })).toBe(true);
    expect(applyLaunchAtLogin(false, { packaged: true, e2e: false, setLoginItem: (settings) => written.push(settings) })).toBe(true);
    expect(written).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });

  it('is never written by a test run, nor by the app run from its sources', () => {
    const written: unknown[] = [];
    expect(applyLaunchAtLogin(true, { packaged: true, e2e: true, setLoginItem: (settings) => written.push(settings) })).toBe(false);
    expect(applyLaunchAtLogin(true, { packaged: false, e2e: false, setLoginItem: (settings) => written.push(settings) })).toBe(false);
    expect(written).toEqual([]);
  });
});
