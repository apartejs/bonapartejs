/**
 * What the app keeps of its plugins (task 11.1), in `<data>/config/plugins.json`: the plugins added — where each
 * came from, when, and an update found for it (proposed, never made) — and what is switched off, for the whole app
 * or for one project. A built-in entry of the core (« Sous-agents », « Titres automatiques », « Scripts du
 * projet ») is switched off here too, under its id. A file that cannot be read is said, and never written over.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pluginSourceSchema, type PluginSource } from '@aparte/bonaparte-shared';
import { z } from 'zod';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';

const fileSchema = z.object({
  installed: z
    .record(z.string(), z.object({ source: pluginSourceSchema, addedAt: z.string(), update: z.string().optional() }))
    .default({}),
  off: z.array(z.string()).default([]),
  /** Switched on by the person, of what is off by default (`OFF_BY_DEFAULT`). */
  on: z.array(z.string()).default([]),
  projects: z.record(z.string(), z.array(z.string())).default({}),
});

type PluginsFile = z.infer<typeof fileSchema>;

export interface InstalledPlugin {
  id: string;
  source: PluginSource;
  addedAt: string;
  /** A newer version found, proposed to the person. */
  update?: string;
}

export class PluginState {
  private readonly queue = new KeyedQueue();

  private constructor(
    private readonly file: string | null,
    private data: PluginsFile,
    /** Why the file could not be read: nothing is then written. */
    readonly error?: string,
  ) {}

  /** The state kept in `file`; with none, in memory only (tests, and a core without a data folder). */
  static async open(file: string | null): Promise<PluginState> {
    const empty: PluginsFile = { installed: {}, off: [], on: [], projects: {} };
    if (!file) return new PluginState(null, empty);
    let found: unknown;
    try {
      found = await readJsonFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new PluginState(file, empty);
      return new PluginState(file, empty, `The plugins' file ${file} cannot be read (${error instanceof Error ? error.message : String(error)}): it is left as it is.`);
    }
    const parsed = fileSchema.safeParse(found);
    if (!parsed.success) return new PluginState(file, empty, `The plugins' file ${file} cannot be read (${parsed.error.issues[0]?.message ?? 'its shape'}): it is left as it is.`);
    return new PluginState(file, parsed.data);
  }

  /** Switched off for the app, or for this project; `byDefault`: off until the person switched it on. */
  isOff(id: string, projectId?: string, byDefault = false): boolean {
    const forApp = byDefault ? !this.data.on.includes(id) : this.data.off.includes(id);
    return forApp || (projectId !== undefined && (this.data.projects[projectId] ?? []).includes(id));
  }

  /** What is off by default, switched on for the app — or off again. */
  setOn(id: string, on: boolean): Promise<void> {
    return this.change((data) => {
      data.on = on ? [...new Set([...data.on, id])] : data.on.filter((one) => one !== id);
    });
  }

  /** What a project switches off of what the app runs. */
  offFor(projectId: string): string[] {
    return [...(this.data.projects[projectId] ?? [])];
  }

  installed(): InstalledPlugin[] {
    return Object.entries(this.data.installed).map(([id, entry]) => ({ id, ...entry }));
  }

  get(id: string): InstalledPlugin | undefined {
    const entry = this.data.installed[id];
    return entry ? { id, ...entry } : undefined;
  }

  setOff(id: string, off: boolean, projectId?: string): Promise<void> {
    return this.change((data) => {
      const list = projectId ? (data.projects[projectId] ?? []) : data.off;
      const next = off ? [...new Set([...list, id])] : list.filter((one) => one !== id);
      if (projectId) data.projects[projectId] = next;
      else data.off = next;
    });
  }

  /** What it came from, checked as the file will be read again: nothing written makes it unreadable. */
  record(id: string, source: PluginSource, addedAt: string): Promise<void> {
    const checked = pluginSourceSchema.safeParse(source);
    if (!checked.success) return Promise.reject(new Error(`Where the plugin ${id} came from cannot be kept: ${checked.error.issues[0]?.message ?? 'not valid'}.`));
    return this.change((data) => {
      data.installed[id] = { source, addedAt };
    });
  }

  setUpdate(id: string, version: string | undefined): Promise<void> {
    return this.change((data) => {
      const entry = data.installed[id];
      if (!entry) return;
      if (version) entry.update = version;
      else delete entry.update;
    });
  }

  /** A plugin removed: it leaves the file, and nothing of it stays switched off. */
  forget(id: string): Promise<void> {
    return this.change((data) => {
      delete data.installed[id];
      data.off = data.off.filter((one) => one !== id);
      data.on = data.on.filter((one) => one !== id);
      for (const project of Object.keys(data.projects)) data.projects[project] = data.projects[project]!.filter((one) => one !== id);
    });
  }

  private change(apply: (data: PluginsFile) => void): Promise<void> {
    return this.queue.run('file', async () => {
      if (this.error) throw new Error(this.error);
      const next: PluginsFile = structuredClone(this.data);
      apply(next);
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        await writeJsonFile(this.file, next);
      }
      this.data = next;
    });
  }
}
