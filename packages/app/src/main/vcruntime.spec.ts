/**
 * The Visual C++ runtime the app carries for llama.cpp (`resources/vcruntime`): a program outside the app loads it, so
 * it is read where it sits on the disk — beside the archive in an installed app (electron-builder unpacks it), in the
 * app's folder otherwise (the npm package, a checkout).
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carriedRuntimeDir } from './vcruntime.js';

describe('the runtime the app carries', () => {
  it('is read beside the archive in an installed app: llama.cpp cannot read inside app.asar', () => {
    const appPath = join('C:', 'bonaparte', 'resources', 'app.asar');
    const unpacked = join('C:', 'bonaparte', 'resources', 'app.asar.unpacked', 'resources', 'vcruntime');
    expect(carriedRuntimeDir(appPath, (path) => path === unpacked)).toBe(unpacked);
  });

  it('is read in the app’s folder otherwise', () => {
    const appPath = join('C:', 'npm', 'app');
    expect(carriedRuntimeDir(appPath, () => true)).toBe(join(appPath, 'resources', 'vcruntime'));
  });

  it('is none when the app carries none (a checkout that did not prepare it, Linux, macOS)', () => {
    expect(carriedRuntimeDir(join('C:', 'checkout', 'packages', 'app'), () => false)).toBeUndefined();
  });
});
