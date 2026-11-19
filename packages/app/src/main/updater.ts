/**
 * The app's own update (task 13.1, design §7.6): electron-updater, on the
 * releases of the repository, only in a packaged app outside a test run. A
 * test run reads its update from `BONAPARTE_E2E_UPDATE` and never asks
 * GitHub. Nothing installs while a reply runs: « Redémarrer » waits for the
 * end of the turn. « Mettre à jour l'app toute seule » (`autoUpdateApp`):
 * downloaded in the background, installed at the next quit.
 */

import { EventEmitter } from 'node:events';
import type { AppUpdateView } from '@aparte/bonaparte-shared';

/** What bonaparte uses of electron-updater's `autoUpdater`. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<{
    updateInfo: { version: string; releaseNotes?: unknown; files?: readonly { size?: number }[] };
    /** The background download, when `autoDownload` started one: it rejects when it fails. */
    downloadPromise?: Promise<unknown> | null;
  } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (progress: { transferred: number; total: number }) => void): unknown;
  on(event: 'update-downloaded', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface AppUpdatesDeps {
  updater: UpdaterLike | null;
  current: string;
  /** The person's « Mettre à jour l'app toute seule ». */
  auto(): Promise<boolean>;
  /** Resolves once no reply holds the engine. */
  whenIdle(): Promise<void>;
  /**
   * Saves the memory and stops the engine before the installer starts: it does not wait for the app — it kills it
   * within seconds (review of phase 13).
   */
  beforeInstall?(): Promise<void>;
  log(line: string): void;
}

export interface AppUpdates {
  /** Asks the releases; null when there is nothing newer, or no way to know. */
  check(): Promise<AppUpdateView | null>;
  state(): AppUpdateView | null;
  /** Once no reply runs: downloaded if it is not, then installed, the app restarted. */
  restart(): Promise<void>;
}

/** `1.10.0` after `1.9.2`: numbers compared part by part; a pre-release tag counts as older. */
export function newer(candidate: string, current: string): boolean {
  const parts = (version: string) => {
    const [main, pre] = version.replace(/^v/, '').split('-', 2);
    return { nums: (main ?? '').split('.').map((one) => Number.parseInt(one, 10) || 0), pre: pre ?? null };
  };
  const a = parts(candidate);
  const b = parts(current);
  for (let index = 0; index < Math.max(a.nums.length, b.nums.length); index += 1) {
    const diff = (a.nums[index] ?? 0) - (b.nums[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return a.pre === null && b.pre !== null;
}

function notesOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    const text = raw
      .map((one) => (one && typeof one === 'object' && 'note' in one && typeof one.note === 'string' ? one.note : ''))
      .filter(Boolean)
      .join('\n');
    return text.trim() || null;
  }
  return null;
}

export function createAppUpdates(deps: AppUpdatesDeps): AppUpdates {
  const { updater } = deps;
  let offer: AppUpdateView | null = null;
  let restarting: Promise<void> | undefined;
  if (updater) {
    updater.on('download-progress', (progress) => {
      if (offer && offer.state !== 'ready') offer = { ...offer, state: 'downloading', progress: { done: progress.transferred, total: progress.total } };
    });
    updater.on('update-downloaded', () => {
      if (offer) offer = { ...offer, state: 'ready', progress: null };
    });
    updater.on('error', (error) => deps.log(`[bonaparte] the app's update failed: ${error.message}`));
  }

  return {
    async check() {
      if (!updater) return null;
      const auto = await deps.auto().catch(() => false);
      // « toute seule »: downloaded in the background, installed at the next quit. Otherwise nothing before a click.
      updater.autoDownload = auto;
      updater.autoInstallOnAppQuit = auto;
      try {
        const found = await updater.checkForUpdates();
        // A download in the background that fails is said by the updater's 'error': never a rejection left unhandled,
        // which would close the app without saving its memory (review of phase 13).
        void found?.downloadPromise?.catch(() => undefined);
        const info = found?.updateInfo;
        if (!info || !newer(info.version, deps.current)) {
          offer = null;
          return null;
        }
        if (offer?.version !== info.version) {
          const size = (info.files ?? []).reduce((sum, file) => sum + (file.size ?? 0), 0);
          offer = { version: info.version, notes: notesOf(info.releaseNotes), bytes: size > 0 ? size : null, state: 'available', progress: null, waiting: false };
        }
        return offer;
      } catch (error) {
        deps.log(`[bonaparte] the app's update could not be checked: ${error instanceof Error ? error.message : String(error)}`);
        return offer;
      }
    },
    state: () => offer,
    restart() {
      if (!updater || !offer) return Promise.resolve();
      restarting ??= (async () => {
        // Downloaded first: a reply sent meanwhile is waited for after, never cut by the restart (review of phase 13).
        if (offer && offer.state !== 'ready') await updater.downloadUpdate();
        offer = offer ? { ...offer, waiting: true } : offer;
        await deps.whenIdle();
        // The memory saved and the engine stopped now: the installer kills the app within seconds of its start.
        await deps.beforeInstall?.();
        updater.quitAndInstall(true, true);
      })().finally(() => {
        restarting = undefined;
        if (offer) offer = { ...offer, waiting: false };
      });
      return restarting;
    },
  };
}

/** A test run's update, read from `BONAPARTE_E2E_UPDATE` (`{ version, bytes?, notes? }`); restarting only counts. */
export function fakeUpdater(env: Record<string, string | undefined>): UpdaterLike | null {
  const raw = env['BONAPARTE_E2E_UPDATE'];
  if (!raw) return null;
  let offer: { version?: unknown; bytes?: unknown; notes?: unknown };
  try {
    offer = JSON.parse(raw) as typeof offer;
  } catch {
    return null;
  }
  if (typeof offer.version !== 'string') return null;
  const version = offer.version;
  const bytes = typeof offer.bytes === 'number' ? offer.bytes : 0;
  const notes = typeof offer.notes === 'string' ? offer.notes : null;
  const fake = new (class extends EventEmitter {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    restarted = 0;
    async checkForUpdates() {
      return { updateInfo: { version, releaseNotes: notes, files: [{ size: bytes }] } };
    }
    async downloadUpdate() {
      this.emit('update-downloaded');
      return [];
    }
    quitAndInstall() {
      this.restarted += 1;
    }
  })();
  return fake as unknown as UpdaterLike;
}

/**
 * Which updater a build runs: a test run's own; a packaged app's electron-updater — except an app the Microsoft Store
 * installed (MSIX, `process.windowsStore`), which the Store updates, and where electron-updater does not work; none
 * when run from the sources.
 */
export function updaterKind(facts: { e2e: boolean; packaged: boolean; windowsStore: boolean }): 'test' | 'packaged' | 'none' {
  if (facts.e2e) return 'test';
  return facts.packaged && !facts.windowsStore ? 'packaged' : 'none';
}
