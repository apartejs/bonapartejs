/**
 * The plugins the person adds (task 11.1): read before anything of them runs, put under `<data>/plugins/<id>/`,
 * started each in a process of its own — unless switched off — at launch and when added; replaced by a newer
 * version, removed with all they added. A built-in plugin is never removed, nor taken over by one of its id.
 */

import { join } from 'node:path';
import type { PluginStatus } from '@aparte/bonaparte-shared';
import type { PluginHost } from './host.js';
import type { PluginAddRequest, PluginInstaller, PreviewResult } from './install.js';
import type { PluginPort } from './remote.js';

export interface AddedPluginsOptions {
  host: PluginHost;
  installer: PluginInstaller;
  /** The app's end of a new process for a plugin: an Electron utility process; a test's own ports. */
  start: (options: { pluginId: string; dir: string }) => PluginPort;
  now?: () => Date;
}

export class AddedPlugins {
  constructor(private readonly options: AddedPluginsOptions) {}

  get host(): PluginHost {
    return this.options.host;
  }

  /** At launch: the plugins added come back as they were — each switched on in its own process, the others kept off. */
  async start(): Promise<void> {
    await this.options.installer.clearStaging();
    const found = await this.host.discover(this.options.installer.root);
    const state = await this.host.keptState();
    for (const plugin of found) {
      if (!plugin.manifest) continue;
      // Put there by hand: it came from that very folder.
      if (!state.get(plugin.id) && plugin.dir && !state.error) {
        await state.record(plugin.id, { kind: 'folder', path: plugin.dir }, (this.options.now?.() ?? new Date()).toISOString()).catch(() => undefined);
      }
      await this.activate(plugin.id).catch(() => undefined);
    }
  }

  async preview(request: PluginAddRequest): Promise<PreviewResult> {
    const result = await this.options.installer.preview(request);
    if (result.ok && this.host.get(result.preview.manifest.id)?.builtin) {
      await this.options.installer.discard(result.preview.stagingId);
      return { ok: false, error: `The id ${result.preview.manifest.id} is a built-in plugin's: this plugin cannot take its place.` };
    }
    return result;
  }

  discard(stagingId: string): Promise<void> {
    return this.options.installer.discard(stagingId);
  }

  /** « Ajouter et activer » or « Ajouter sans activer »: one of the same id goes first — its process holds its files. */
  async install(stagingId: string, options: { enable: boolean }): Promise<PluginStatus> {
    const manifest = this.options.installer.stagedManifest(stagingId);
    if (!manifest) throw new Error('This plugin is no longer ready to be added: read it again.');
    if (this.host.get(manifest.id)?.builtin) throw new Error(`The id ${manifest.id} is a built-in plugin's: this plugin cannot take its place.`);
    await this.host.forget(manifest.id);
    const done = await this.options.installer.install(stagingId);
    const state = await this.host.keptState();
    await state.record(done.id, done.source, (this.options.now?.() ?? new Date()).toISOString());
    await state.setOff(done.id, !options.enable);
    this.host.add(done.manifest, { builtin: false, dir: done.dir });
    return this.activate(done.id);
  }

  /** Removed: torn down, its folder gone, nothing of it left in what the app keeps. */
  async remove(id: string): Promise<void> {
    if (this.host.get(id)?.builtin) throw new Error(`${id} is a built-in plugin: it can be switched off, not removed.`);
    await this.host.forget(id);
    await this.options.installer.remove(id);
    await (await this.host.keptState()).forget(id);
  }

  /** Where each came from is asked for a newer version: found, it is proposed — nothing is changed. */
  async checkUpdates(): Promise<{ id: string; update: string }[]> {
    const state = await this.host.keptState();
    const found: { id: string; update: string }[] = [];
    for (const plugin of state.installed()) {
      const update = await this.options.installer.checkUpdate(plugin.source).catch(() => undefined);
      await state.setUpdate(plugin.id, update);
      if (update) found.push({ id: plugin.id, update });
    }
    return found;
  }

  private activate(id: string): Promise<PluginStatus> {
    const dir = join(this.options.installer.root, id);
    return this.host.activateRemote(id, () => this.options.start({ pluginId: id, dir }));
  }
}
