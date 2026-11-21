import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { checkFailure, createAppUpdates, fakeUpdater, updaterKind, type UpdaterLike } from './updater.js';

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

describe('which updater runs (the Store, review of the distribution)', () => {
  it('a packaged app updates itself; installed by the Microsoft Store, the Store updates it — never electron-updater', () => {
    expect(updaterKind({ e2e: false, packaged: true, windowsStore: false })).toBe('packaged');
    expect(updaterKind({ e2e: false, packaged: true, windowsStore: true })).toBe('none');
    expect(updaterKind({ e2e: false, packaged: false, windowsStore: false })).toBe('none');
    expect(updaterKind({ e2e: true, packaged: false, windowsStore: false })).toBe('test');
  });
});

/** An error as electron-updater throws it: builder-util-runtime's `HttpError` has `statusCode`, `newError` a `code`. */
const updaterError = (message: string, extra: { statusCode?: number; code?: string } = {}): Error => Object.assign(new Error(message), extra);

describe('the app’s update that cannot be checked is said, in words (audit 2026-11-21, N4)', () => {
  it('a private repository: its releases feed answers 404 (or 401) to an app that has no token', () => {
    expect(checkFailure(updaterError('404 "method: GET url: https://github.com/apartejs/bonapartejs/releases.atom"', { statusCode: 404 }))).toEqual({ reason: 'private', status: 404, detail: null });
    expect(checkFailure(updaterError('HttpError: 401 Unauthorized', { statusCode: 401 }))).toMatchObject({ reason: 'private', status: 401 });
    // The status inside the message when the updater wrapped it.
    expect(checkFailure(updaterError('Cannot parse: HttpError: 404 \n"method: GET"'))).toMatchObject({ reason: 'private', status: 404 });
  });

  it('no network: Chromium’s and Node’s own words', () => {
    for (const message of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_CONNECTION_TIMED_OUT', 'getaddrinfo ENOTFOUND github.com']) {
      expect(checkFailure(updaterError(message)), message).toEqual({ reason: 'offline', status: null, detail: null });
    }
    expect(checkFailure(updaterError('connect', { code: 'ECONNREFUSED' }))).toMatchObject({ reason: 'offline' });
  });

  it('nothing published yet: a draft, or a release without its latest.yml', () => {
    expect(checkFailure(updaterError('No published versions on GitHub', { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }))).toMatchObject({ reason: 'unpublished' });
    expect(checkFailure(updaterError('Cannot find latest.yml in the latest release artifacts: HttpError: 404', { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }))).toMatchObject({ reason: 'unpublished' });
    expect(checkFailure(updaterError('Unable to find latest version on GitHub: HttpError: 404', { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }))).toMatchObject({ reason: 'unpublished' });
  });

  it('GitHub refusing (403, 429: too many requests) keeps its status', () => {
    expect(checkFailure(updaterError('rate limited', { statusCode: 403 }))).toEqual({ reason: 'refused', status: 403, detail: null });
    expect(checkFailure(updaterError('slow down', { statusCode: 429 }))).toMatchObject({ reason: 'refused', status: 429 });
  });

  it('anything else gives its own first line, cut short — never « erreur inconnue »', () => {
    expect(checkFailure(updaterError(`sha512 checksum mismatch\n${'x'.repeat(500)}`))).toEqual({ reason: 'other', status: null, detail: 'sha512 checksum mismatch' });
    expect(checkFailure(updaterError('y'.repeat(400))).detail).toHaveLength(160);
    expect(checkFailure('a string thrown')).toEqual({ reason: 'other', status: null, detail: 'a string thrown' });
    expect(checkFailure(updaterError('server error', { statusCode: 502 }))).toEqual({ reason: 'other', status: 502, detail: 'server error' });
  });

  it('the updater keeps why its last check failed, and forgets it once a check succeeds', async () => {
    const updater = new Updater({ version: '1.1.0' });
    const succeed = updater.checkForUpdates.bind(updater);
    updater.checkForUpdates = async () => {
      throw updaterError('404', { statusCode: 404 });
    };
    const updates = createAppUpdates(deps(updater));
    expect(updates.failure()).toBeNull();
    expect(await updates.check()).toBeNull();
    expect(updates.failure()).toEqual({ reason: 'private', status: 404, detail: null });
    updater.checkForUpdates = succeed;
    expect(await updates.check()).toMatchObject({ version: '1.1.0' });
    expect(updates.failure()).toBeNull();
  });

  it('a build that does not update itself has nothing to say', async () => {
    const updates = createAppUpdates(deps(null));
    await updates.check();
    expect(updates.failure()).toBeNull();
  });

  it('a test run fails its check as asked: `BONAPARTE_E2E_UPDATE` `{ "fail": { "statusCode": 404 } }`', async () => {
    const fake = fakeUpdater({ BONAPARTE_E2E_UPDATE: JSON.stringify({ fail: { statusCode: 404, message: 'HttpError: 404' } }) })!;
    const updates = createAppUpdates(deps(fake));
    expect(await updates.check()).toBeNull();
    expect(updates.failure()).toEqual({ reason: 'private', status: 404, detail: null });
    const offline = createAppUpdates(deps(fakeUpdater({ BONAPARTE_E2E_UPDATE: JSON.stringify({ fail: { message: 'net::ERR_INTERNET_DISCONNECTED' } }) })));
    await offline.check();
    expect(offline.failure()).toMatchObject({ reason: 'offline' });
  });
});
