/**
 * Everything bonaparte keeps lives under one folder. A test run, and the
 * end-to-end tests above all, must be able to point it elsewhere: launching
 * the app to check it must never touch the person's real conversations.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bonaparteDataDir } from './paths.js';

describe('bonaparteDataDir', () => {
  it('is BONAPARTE_DATA_DIR when it is set, on any platform', () => {
    const env = { BONAPARTE_DATA_DIR: join('tmp', 'run-1'), APPDATA: join('C:', 'Users', 'x', 'AppData', 'Roaming') };
    expect(bonaparteDataDir(env, 'win32')).toBe(join('tmp', 'run-1'));
    expect(bonaparteDataDir(env, 'linux')).toBe(join('tmp', 'run-1'));
  });

  it('is the bonaparte folder of %APPDATA% on Windows', () => {
    const appData = join('C:', 'Users', 'x', 'AppData', 'Roaming');
    expect(bonaparteDataDir({ APPDATA: appData }, 'win32')).toBe(join(appData, 'bonaparte'));
  });

  it('is ~/.bonaparte elsewhere, and on a Windows without APPDATA', () => {
    const home = join('home', 'x');
    expect(bonaparteDataDir({}, 'linux', home)).toBe(join(home, '.bonaparte'));
    expect(bonaparteDataDir({ APPDATA: 'ignored' }, 'darwin', home)).toBe(join(home, '.bonaparte'));
    expect(bonaparteDataDir({}, 'win32', home)).toBe(join(home, '.bonaparte'));
  });
});
