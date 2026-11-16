/**
 * What this machine measured, per model (P2.8): how long it took to load,
 * how fast it prefills. The costs announced before a switch, a reload or a
 * resume come from here — kept across launches, or they would be stated
 * only once the model had been loaded and used again.
 *
 * A small JSON file, read once on first use, rewritten after each change
 * (a load, a turn): rare writes, serialised.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ModelMeasures {
  /** Seconds the model took to become ready, last time. */
  loadSeconds?: number;
  /** Prompt tokens per second, a running average over measured turns. */
  prefillTokensPerSecond?: number;
  /** When the model was last loaded (ISO date): « Dernière fois » in Settings, Models. */
  lastLoadedAt?: string;
}

interface MeasureFile {
  version: 1;
  models: Record<string, ModelMeasures>;
}

export class MeasureStore {
  private models: Map<string, ModelMeasures> | null = null;
  private writing: Promise<void> = Promise.resolve();

  /** Without a file, the figures live as long as the process. */
  constructor(private readonly file?: string) {}

  get(modelPath: string): ModelMeasures | undefined {
    return this.load().get(modelPath);
  }

  /** The model loaded last on this machine; undefined for none. */
  lastLoaded(): string | undefined {
    let last: { path: string; at: string } | undefined;
    for (const [path, figures] of this.load()) {
      if (figures.lastLoadedAt && (!last || figures.lastLoadedAt > last.at)) last = { path, at: figures.lastLoadedAt };
    }
    return last?.path;
  }

  record(modelPath: string, figures: ModelMeasures): void {
    const kept: ModelMeasures = {};
    if (isMeasure(figures.loadSeconds, true)) kept.loadSeconds = figures.loadSeconds;
    if (isMeasure(figures.prefillTokensPerSecond, false)) kept.prefillTokensPerSecond = figures.prefillTokensPerSecond;
    if (typeof figures.lastLoadedAt === 'string' && !Number.isNaN(Date.parse(figures.lastLoadedAt))) kept.lastLoadedAt = figures.lastLoadedAt;
    if (Object.keys(kept).length === 0) return;
    const models = this.load();
    models.set(modelPath, { ...models.get(modelPath), ...kept });
    if (!this.file) return;
    const file = this.file;
    const content: MeasureFile = { version: 1, models: Object.fromEntries(models) };
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(content, null, 2), 'utf8');
      })
      .catch(() => undefined);
  }

  /** Resolves once every recorded figure is on disk. */
  flush(): Promise<void> {
    return this.writing;
  }

  private load(): Map<string, ModelMeasures> {
    if (this.models) return this.models;
    this.models = new Map();
    if (!this.file) return this.models;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<MeasureFile>;
      if (raw.version === 1 && raw.models && typeof raw.models === 'object') {
        for (const [path, figures] of Object.entries(raw.models)) {
          if (figures && typeof figures === 'object') this.models.set(path, figures);
        }
      }
    } catch {
      // Absent or unreadable: nothing measured yet.
    }
    return this.models;
  }
}

function isMeasure(value: number | undefined, zeroAllowed: boolean): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (zeroAllowed ? value >= 0 : value > 0);
}
