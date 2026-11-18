import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createAppUpdates, fakeUpdater, type UpdaterLike } from './updater.js';

class Updater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checks = 0;
  downloads = 0;
  installed: unknown[] = [];
  constructor(private readonly offer: { version: string; size?: number; notes?: string } | null) {
    super();
  }
  async checkForUpdates() {
    this.checks += 1;
    return this.offer
      ? { updateInfo: { version: this.offer.version, releaseNotes: this.offer.notes ?? null, files: [{ size: this.offer.size ?? 0 }] } }
      : null;
  }
  async downloadUpdate() {
    this.downloads += 1;
    this.emit('download-progress', { transferred: 5, total: 10 });
    this.emit('update-downloaded', {});
    return [];
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installed.push([isSilent, isForceRunAfter]);
  }
}

const deps = (updater: UpdaterLike | null, over: Partial<Parameters<typeof createAppUpdates>[0]> = {}) => ({
  updater,
  current: '1.0.0',
  auto: async () => true,
  whenIdle: async () => undefined,
  log: () => undefined,
  ...over,
});

describe('the app updates itself (task 13.1)', () => {
  it('a build that does not update itself offers nothing and asks nothing', async () => {
    const updates = createAppUpdates(deps(null));
    expect(await updates.check()).toBeNull();
    expect(updates.state()).toBeNull();
  });

  it('says a newer version with its size; with « toute seule », downloads it to install at the next quit', async () => {
    const updater = new Updater({ version: '1.1.0', size: 90_000_000, notes: 'Ctrl K' });
    const updates = createAppUpdates(deps(updater));
    const offer = await updates.check();
    expect(offer).toMatchObject({ version: '1.1.0', bytes: 90_000_000, notes: 'Ctrl K' });
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.autoDownload).toBe(true);
    updater.emit('update-downloaded', {});
    expect(updates.state()).toMatchObject({ state: 'ready' });
  });

  it('without « toute seule », downloads nothing until « Redémarrer »', async () => {
    const updater = new Updater({ version: '1.1.0' });
    const updates = createAppUpdates(deps(updater, { auto: async () => false }));
    await updates.check();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.downloads).toBe(0);
    await updates.restart();
    expect(updater.downloads).toBe(1);
    expect(updater.installed).toEqual([[true, true]]);
  });

  it('an older or equal version is no update', async () => {
    expect(await createAppUpdates(deps(new Updater({ version: '1.0.0' }))).check()).toBeNull();
    expect(await createAppUpdates(deps(new Updater({ version: '0.9.0' }))).check()).toBeNull();
  });

  it('« Redémarrer » waits for the end of the reply before it installs', async () => {
    const updater = new Updater({ version: '1.1.0' });
    let free!: () => void;
    const idle = new Promise<void>((resolve) => (free = resolve));
    const updates = createAppUpdates(deps(updater, { whenIdle: () => idle }));
    await updates.check();
    updater.emit('update-downloaded', {});
    const restarting = updates.restart();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updater.installed).toEqual([]);
    expect(updates.state()?.waiting).toBe(true);
    free();
    await restarting;
    expect(updater.installed).toEqual([[true, true]]);
  });

  it('a check that fails is logged and offers nothing — never « up to date » said in its place', async () => {
    const updater = new Updater(null);
    updater.checkForUpdates = async () => {
      throw new Error('offline');
    };
    const lines: string[] = [];
    const updates = createAppUpdates(deps(updater, { log: (line) => lines.push(line) }));
    expect(await updates.check()).toBeNull();
    expect(lines.join('\n')).toMatch(/offline/);
  });

  it('a test run reads its update from the environment, and restarting only says so', async () => {
    expect(fakeUpdater({})).toBeNull();
    expect(fakeUpdater({ BONAPARTE_E2E_UPDATE: 'not json' })).toBeNull();
    const fake = fakeUpdater({ BONAPARTE_E2E_UPDATE: JSON.stringify({ version: '1.1.0', bytes: 1000, notes: 'Ctrl K' }) })!;
    const updates = createAppUpdates(deps(fake));
    expect(await updates.check()).toMatchObject({ version: '1.1.0', bytes: 1000, notes: 'Ctrl K' });
    await updates.restart();
    expect((fake as unknown as { restarted: number }).restarted).toBe(1);
  });
});

describe('the app’s update, review of phase 13', () => {
  it('a background download that fails is logged — never a rejection left unhandled, which would close the app', async () => {
    const updater = new Updater({ version: '1.1.0' });
    const failing = Promise.reject(new Error('network gone'));
    updater.checkForUpdates = async () => ({ updateInfo: { version: '1.1.0', files: [] }, downloadPromise: failing }) as never;
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      await createAppUpdates(deps(updater)).check();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('« Redémarrer » downloads first, then waits for the end of the reply, saves the memory, and only then installs', async () => {
    const order: string[] = [];
    const updater = new Updater({ version: '1.1.0' });
    updater.downloadUpdate = async () => {
      order.push('download');
      updater.emit('update-downloaded', {});
      return [];
    };
    updater.quitAndInstall = () => void order.push('install');
    const updates = createAppUpdates(
      deps(updater, {
        auto: async () => false,
        whenIdle: async () => void order.push('idle'),
        beforeInstall: async () => void order.push('save'),
      }),
    );
    await updates.check();
    await updates.restart();
    expect(order).toEqual(['download', 'idle', 'save', 'install']);
  });
});
