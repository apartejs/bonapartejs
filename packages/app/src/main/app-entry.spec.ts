/**
 * Launching Electron on an app that is not built puts a native error box on
 * the person's screen, once per launch. The end-to-end fixture therefore asks
 * for the app's entry first, and that question fails without launching anything.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtAppEntry } from '../../e2e/fixtures/app-entry.js';

describe('builtAppEntry', () => {
  it('refuses, with what to do, when the app is not built', async () => {
    const appRoot = await mkdtemp(join(tmpdir(), 'bp-entry-'));
    expect(() => builtAppEntry(appRoot)).toThrow(/pnpm build/);
  });

  it('gives the entry of the main process when the app is built', async () => {
    const appRoot = await mkdtemp(join(tmpdir(), 'bp-entry-'));
    await mkdir(join(appRoot, 'out', 'main'), { recursive: true });
    await mkdir(join(appRoot, 'out', 'renderer'), { recursive: true });
    await writeFile(join(appRoot, 'out', 'main', 'index.js'), '');
    await writeFile(join(appRoot, 'out', 'renderer', 'index.html'), '');
    expect(builtAppEntry(appRoot)).toBe(join(appRoot, 'out', 'main', 'index.js'));
  });

  it('refuses a build that has a main process but no window', async () => {
    const appRoot = await mkdtemp(join(tmpdir(), 'bp-entry-'));
    await mkdir(join(appRoot, 'out', 'main'), { recursive: true });
    await writeFile(join(appRoot, 'out', 'main', 'index.js'), '');
    expect(() => builtAppEntry(appRoot)).toThrow(/pnpm build/);
  });
});
