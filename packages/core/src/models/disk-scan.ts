/**
 * « Chercher sur tout le disque (plus long) » (Settings, Models — task 5.7):
 * the whole disk walked for models, deeper than the known folders, the
 * folders no model lives in skipped. It says how far it went (the folders
 * visited) while it runs, it can be cancelled, and when it ends it hands the
 * folders where it found models to be added to the ones searched — nothing
 * when it was cancelled. One search at a time.
 */

import { access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { scanModels } from './inventory.js';

export interface DiskScanState {
  running: boolean;
  done: boolean;
  cancelled: boolean;
  /** Folders visited so far. */
  visited: number;
  /** The folders where it found models, once it ended. */
  folders: string[];
}

/** Folders no model lives in: the system's, the packages, the repositories' innards. */
const SKIPPED = new Set(['windows', '$recycle.bin', 'system volume information', 'node_modules', '.git', 'programdata', 'program files', 'program files (x86)']);

/** The drives of the machine: every letter that answers on Windows, the root elsewhere. */
export async function diskRoots(platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform !== 'win32') return ['/'];
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const found = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        await access(root);
        return root;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((root): root is string => root !== null);
}

export class DiskScan {
  private current: DiskScanState = { running: false, done: false, cancelled: false, visited: 0, folders: [] };
  private stop: AbortController | null = null;
  private finished: Promise<void> = Promise.resolve();

  constructor(
    private readonly roots: () => Promise<string[]>,
    private readonly onFound: (folders: string[]) => Promise<void>,
  ) {}

  state(): DiskScanState {
    return { ...this.current, folders: [...this.current.folders] };
  }

  /** Resolves when the search under way ends (at once when none runs). */
  whenDone(): Promise<void> {
    return this.finished;
  }

  start(): void {
    if (this.current.running) return;
    const stop = new AbortController();
    this.stop = stop;
    this.current = { running: true, done: false, cancelled: false, visited: 0, folders: [] };
    this.finished = (async () => {
      try {
        const roots = await this.roots();
        const found = await scanModels(
          roots.map((dir) => ({ dir, source: 'custom' as const })),
          {
            maxDepth: 12,
            signal: stop.signal,
            skip: (name) => SKIPPED.has(name.toLowerCase()),
            onDirectory: () => {
              this.current.visited += 1;
            },
          },
        );
        if (stop.signal.aborted) {
          this.current = { ...this.current, running: false, done: true, cancelled: true };
          return;
        }
        const folders = [...new Set(found.map((model) => dirname(model.path)))];
        this.current = { ...this.current, folders };
        if (folders.length > 0) await this.onFound(folders);
        this.current = { ...this.current, running: false, done: true };
      } catch {
        this.current = { ...this.current, running: false, done: true, cancelled: stop.signal.aborted };
      }
    })();
  }

  cancel(): void {
    this.stop?.abort();
  }
}
