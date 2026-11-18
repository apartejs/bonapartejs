/**
 * The plugins the person adds (task 11.1): read before anything of them runs, put under `<data>/plugins/<id>/`,
 * started each in a process of its own — unless switched off — at launch and when added; replaced by a newer
 * version, removed with all they added. A built-in plugin is never removed, nor taken over by one of its id.
 */

import { join } from 'node:path';
import type { PluginStatus } from '@aparte/bonaparte-shared';
import type { PluginHost } from './host.js';
import type { PluginAddRequest, PluginInstaller, PreviewResult } from './install.js';
import type { Extension } from './extensions.js';
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

  /**
   * « Essayer dans cette conversation » or `extension_run` (task 11.4): a revision made in a conversation runs in
   * its own process, its tools seen by that conversation only. A plugin added of the same id is not taken over.
   */
  async tryExtension(extension: Extension): Promise<PluginStatus> {
    const known = this.host.get(extension.id);
    const trial = this.trialOf(extension.id);
    if (known && (known.builtin || trial === undefined)) {
      throw new Error(`A plugin ${extension.id} is already added: give this one another id to try it.`);
    }
    if (trial !== undefined && trial !== extension.conversationId) {
      throw new Error(`A plugin ${extension.id} is on trial in another conversation: give this one another id to try it.`);
    }
    await this.host.forget(extension.id);
    this.host.add(extension.manifest, { builtin: false, dir: extension.dir });
    this.host.trialIn(extension.id, extension.conversationId);
    return this.host.activateRemote(extension.id, () => this.options.start({ pluginId: extension.id, dir: extension.dir }));
  }

  /** The trial ends: all it added goes. Asked by a conversation, only that conversation's own trial. */
  async stopTrial(id: string, conversationId?: string): Promise<boolean> {
    const trial = this.trialOf(id);
    if (trial === undefined) return false;
    if (conversationId !== undefined && trial !== conversationId) return false;
    await this.host.forget(id);
    return true;
  }

  /** A conversation that goes (deleted) takes its trials with it. */
  async stopTrialsOf(conversationId: string): Promise<void> {
    for (const plugin of this.host.status()) {
      if (plugin.trial === conversationId) await this.host.forget(plugin.id);
    }
  }

  private trialOf(id: string): string | undefined {
    return this.host.status().find((one) => one.id === id)?.trial;
  }

  /**
   * « Installer »: the revision becomes a plugin added like the others, said to come from its conversation. It never
   * takes the place of a built-in, of a plugin the person added from elsewhere, or of another conversation's trial;
   * one installed from this same conversation before is replaced by it.
   */
  async installExtension(extension: Extension, title?: string): Promise<PluginStatus> {
    const known = this.host.get(extension.id);
    if (known?.builtin) throw new Error(`The id ${extension.id} is a built-in plugin's: this plugin cannot take its place. Give it another id.`);
    const trial = this.trialOf(extension.id);
    if (trial !== undefined && trial !== extension.conversationId) {
      throw new Error(`A plugin ${extension.id} is on trial in another conversation: give this one another id.`);
    }
    if (known && trial === undefined) {
      const source = (await this.host.keptState()).get(extension.id)?.source;
      if (source?.kind !== 'conversation' || source.conversationId !== extension.conversationId) {
        throw new Error(`A plugin ${extension.id} is already added: give this one another id to install it.`);
      }
    }
    await this.stopTrial(extension.id);
    const read = await this.options.installer.preview({ kind: 'folder', path: extension.dir });
    if (!read.ok) throw new Error(read.error);
    await this.host.forget(extension.id);
    const done = await this.options.installer.install(read.preview.stagingId);
    const state = await this.host.keptState();
    await state.record(done.id, { kind: 'conversation', conversationId: extension.conversationId, ...(title ? { title: title.slice(0, 256) } : {}) }, (this.options.now?.() ?? new Date()).toISOString());
    await state.setOff(done.id, false);
    this.host.add(done.manifest, { builtin: false, dir: done.dir });
    return this.activate(done.id);
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
