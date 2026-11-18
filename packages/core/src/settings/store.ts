/**
 * The app's settings (the catalog's `APP_SETTINGS`, global scope), as the
 * person left them. They live in the configuration file, under `settings`,
 * beside what the file already holds (the engine's backend and settings): a
 * write reads the file again and keeps every other key. A value is checked
 * before it is kept (security rule 1), and a change is said to whoever
 * listens — the main process applies « launch at login » and « close to the
 * tray » as they change.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { APP_SETTINGS, ENGINE_SETTINGS } from './catalog.js';
import { validateSettingValue } from './validate.js';

type Listener = (key: string, value: unknown) => void;

export class SettingsStore {
  private readonly writes = new KeyedQueue();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly file: string) {}

  /** The person's value, or the setting's default. An unknown key is an error, never `undefined`. */
  async get(key: string): Promise<unknown> {
    const field = APP_SETTINGS.find((candidate) => candidate.key === key);
    if (!field) throw new Error(`Unknown setting: ${key}`);
    const kept = (await this.read()).settings;
    return kept && Object.hasOwn(kept, key) ? kept[key] : field.default;
  }

  /** Every app setting, with the person's value or its default. */
  async all(): Promise<{ key: string; value: unknown }[]> {
    const kept = (await this.read()).settings ?? {};
    return APP_SETTINGS.map((field) => ({ key: field.key, value: Object.hasOwn(kept, field.key) ? kept[field.key] : field.default }));
  }

  /** Keeps a value; `undefined` removes it, and the default comes back. */
  async set(key: string, value: unknown): Promise<void> {
    validateSettingValue(APP_SETTINGS, 'global', key, value);
    await this.writes.run('file', async () => {
      const content = await this.read();
      const settings = { ...content.settings };
      if (value === undefined) delete settings[key];
      else settings[key] = value;
      await mkdir(dirname(this.file), { recursive: true });
      await writeJsonFile(this.file, { ...content, settings });
    });
    for (const listener of this.listeners) listener(key, value === undefined ? await this.get(key) : value);
  }

  /**
   * The settings llama.cpp is launched with (task 7.4: the context, the K/V cache type), under `engine`: each
   * checked against the catalog, the file's other keys kept — written in turn with the app's settings.
   */
  async setEngine(changes: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(changes)) validateSettingValue(ENGINE_SETTINGS, 'global', key, value);
    await this.writes.run('file', async () => {
      const content = await this.read();
      const engine = content['engine'];
      const kept = engine && typeof engine === 'object' && !Array.isArray(engine) ? (engine as Record<string, unknown>) : {};
      await mkdir(dirname(this.file), { recursive: true });
      await writeJsonFile(this.file, { ...content, engine: { ...kept, ...changes } });
    });
  }

  /** The llama.cpp the person chose (task 12.3), under `backend`: the file's other keys kept. */
  async setBackend(backend: { mode: 'managed'; binPath: string }): Promise<void> {
    await this.writes.run('file', async () => {
      const content = await this.read();
      await mkdir(dirname(this.file), { recursive: true });
      await writeJsonFile(this.file, { ...content, backend });
    });
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async read(): Promise<{ settings?: Record<string, unknown> } & Record<string, unknown>> {
    try {
      const raw = await readJsonFile(this.file);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const content = raw as Record<string, unknown>;
      const settings = content['settings'];
      return settings && typeof settings === 'object' && !Array.isArray(settings)
        ? { ...content, settings: settings as Record<string, unknown> }
        : { ...content, settings: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}
