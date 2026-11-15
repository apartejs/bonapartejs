/**
 * The app's settings, as the person left them (task 5.9, and the settings
 * pages of 5.7): read with their default when nothing was written, written
 * beside what the configuration file already holds, checked before they are
 * kept, and said to whoever listens when they change.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function configFile(content?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-settings-'));
  dirs.push(dir);
  const file = join(dir, 'config', 'global.json');
  if (content !== undefined) {
    await mkdir(join(dir, 'config'), { recursive: true });
    await writeFile(file, JSON.stringify(content));
  }
  return file;
}

describe('SettingsStore', () => {
  it('reads a setting nobody wrote as its default', async () => {
    const store = new SettingsStore(await configFile());
    expect(await store.get('closeToTray')).toBe(true);
    expect(await store.get('launchAtLogin')).toBe(false);
    expect(await store.get('reopenLast')).toBe(true);
  });

  it('keeps what is written, beside what the file already held', async () => {
    const file = await configFile({ backend: { mode: 'remote', url: 'http://127.0.0.1:8080' } });
    await new SettingsStore(file).set('closeToTray', false);
    expect(await new SettingsStore(file).get('closeToTray')).toBe(false);
    const written = JSON.parse(await readFile(file, 'utf8')) as { backend?: unknown };
    expect(written.backend).toEqual({ mode: 'remote', url: 'http://127.0.0.1:8080' });
  });

  it('refuses a value of the wrong type, and a key that is not an app setting', async () => {
    const store = new SettingsStore(await configFile());
    await expect(store.set('closeToTray', 'yes')).rejects.toThrow(/boolean/);
    await expect(store.set('nCtx', 4096)).rejects.toThrow(/Unknown setting/);
    await expect(store.get('nope')).rejects.toThrow(/Unknown setting/);
    expect(await store.get('closeToTray')).toBe(true);
  });

  it('says a change to whoever listens, until they stop', async () => {
    const store = new SettingsStore(await configFile());
    const heard: [string, unknown][] = [];
    const stop = store.onChange((key, value) => heard.push([key, value]));
    await store.set('launchAtLogin', true);
    stop();
    await store.set('launchAtLogin', false);
    expect(heard).toEqual([['launchAtLogin', true]]);
  });

  it("lists every app setting with its value, the person's or its default", async () => {
    const store = new SettingsStore(await configFile());
    await store.set('theme', 'dark');
    const all = await store.all();
    expect(all).toContainEqual({ key: 'theme', value: 'dark' });
    expect(all).toContainEqual({ key: 'accent', value: 'blue' });
    expect(all.map((entry) => entry.key)).not.toContain('nCtx');
  });

  it('removes a value with undefined: the default comes back', async () => {
    const store = new SettingsStore(await configFile());
    await store.set('reopenLast', false);
    await store.set('reopenLast', undefined);
    expect(await store.get('reopenLast')).toBe(true);
  });
});
