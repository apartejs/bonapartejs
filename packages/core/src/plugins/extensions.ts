/**
 * The plugins made in a conversation (task 11.4): what `extension_define` writes. Each definition is a revision
 * of its own, under `<data>/extensions/<conversation>/<id>/<rev>/` — its manifest (`plugin.json`, its Node half
 * named `index.mjs`) and its code —, never written again: a change is a new revision. The code is compiled without
 * being run (`node --check`); a code that does not compile is refused with what to fix, said to the model in
 * English, and nothing of it is kept.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest, type PluginManifest } from '@aparte/bonaparte-shared';
import { spawnHidden, type SpawnFn } from '../process/spawn.js';
import { PLUGIN_MANIFEST_FILE } from './host.js';

export const EXTENSION_ENTRY = 'index.mjs';
const CHECK_TIMEOUT_MS = 30_000;

export interface Extension {
  conversationId: string;
  id: string;
  rev: number;
  dir: string;
  manifest: PluginManifest;
  /** The lines of its code. */
  lines: number;
}

export type DefineResult = { ok: true; extension: Extension } | { ok: false; error: string };

export interface ExtensionStoreOptions {
  dataDir: string;
  env: () => Record<string, string>;
  /** Tests only. */
  spawn?: SpawnFn;
}

export class ExtensionStore {
  private readonly known = new Map<string, Map<string, Extension>>();

  constructor(private readonly options: ExtensionStoreOptions) {}

  private dirOf(conversationId: string, id?: string, rev?: number): string {
    const base = join(this.options.dataDir, 'extensions', conversationId);
    if (!id) return base;
    return rev === undefined ? join(base, id) : join(base, id, String(rev));
  }

  /** The revisions on disk, read again (at launch). */
  async load(): Promise<void> {
    const root = join(this.options.dataDir, 'extensions');
    for (const conversation of await readdir(root).catch(() => [])) {
      for (const id of await readdir(join(root, conversation)).catch(() => [])) {
        const revs = (await readdir(join(root, conversation, id)).catch(() => [])).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
        const rev = revs.at(-1);
        if (rev === undefined) continue;
        const dir = this.dirOf(conversation, id, rev);
        const parsed = parseManifest(JSON.parse(await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8').catch(() => 'null')));
        if (!parsed.ok) continue;
        const code = await readFile(join(dir, EXTENSION_ENTRY), 'utf8').catch(() => '');
        this.remember({ conversationId: conversation, id, rev, dir, manifest: parsed.manifest, lines: code.split('\n').filter(Boolean).length });
      }
    }
  }

  /** The newest revision of each plugin made in this conversation. */
  latest(conversationId: string): Extension[] {
    return [...(this.known.get(conversationId)?.values() ?? [])];
  }

  get(conversationId: string, id: string): Extension | undefined {
    return this.known.get(conversationId)?.get(id);
  }

  /** One revision as it was written — what its card showed —, read from disk; none when it is not there. */
  async revision(conversationId: string, id: string, rev: number): Promise<Extension | undefined> {
    if (!/^[\w-]{1,128}$/.test(conversationId) || !/^[a-z][a-z0-9-]*$/.test(id) || !Number.isInteger(rev) || rev < 1) return undefined;
    const dir = this.dirOf(conversationId, id, rev);
    const raw = await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8').catch(() => null);
    if (raw === null) return undefined;
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const parsed = parseManifest(json);
    if (!parsed.ok) return undefined;
    const code = await readFile(join(dir, EXTENSION_ENTRY), 'utf8').catch(() => '');
    return { conversationId, id, rev, dir, manifest: parsed.manifest, lines: code.split('\n').filter(Boolean).length };
  }

  async define(conversationId: string, input: { manifest: unknown; code: string }): Promise<DefineResult> {
    if (!/^[\w-]{1,128}$/.test(conversationId)) return { ok: false, error: 'This conversation cannot hold a plugin.' };
    const raw = typeof input.manifest === 'object' && input.manifest !== null ? { ...(input.manifest as Record<string, unknown>), entry: { node: EXTENSION_ENTRY } } : input.manifest;
    const parsed = parseManifest(raw);
    if (!parsed.ok) return { ok: false, error: `The manifest does not read: ${parsed.error}. Fix it and define the plugin again.` };
    const manifest = parsed.manifest;
    const revs = (await readdir(this.dirOf(conversationId, manifest.id)).catch(() => [])).map(Number).filter(Number.isInteger);
    const rev = Math.max(0, ...revs) + 1;
    const dir = this.dirOf(conversationId, manifest.id, rev);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, PLUGIN_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(dir, EXTENSION_ENTRY), input.code);
    const checked = await this.check(join(dir, EXTENSION_ENTRY));
    if (checked) {
      await rm(dir, { recursive: true, force: true });
      return { ok: false, error: `The code does not compile:\n${checked}\nFix it and define the plugin again; nothing was kept.` };
    }
    const extension: Extension = { conversationId, id: manifest.id, rev, dir, manifest, lines: input.code.split('\n').filter(Boolean).length };
    this.remember(extension);
    return { ok: true, extension };
  }

  /** Every revision of it goes. */
  async undefine(conversationId: string, id: string): Promise<void> {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) return;
    await rm(this.dirOf(conversationId, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.known.get(conversationId)?.delete(id);
  }

  private remember(extension: Extension): void {
    const of = this.known.get(extension.conversationId) ?? new Map<string, Extension>();
    of.set(extension.id, extension);
    this.known.set(extension.conversationId, of);
  }

  /** Compiled without being run: what `node --check` says, or null when it compiles. */
  private check(file: string): Promise<string | null> {
    return new Promise((done) => {
      // In the app, the running program is Electron: told to behave as Node for this check.
      const child = spawnHidden(process.execPath, ['--check', file], {
        env: { ...this.options.env(), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
      });
      let said = '';
      const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => (said += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (said += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        done(error.message);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // The lines that say where and what: the path of the folder is no use to the model.
        done(code === 0 ? null : said.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('Node.js')).slice(0, 8).join('\n').replaceAll(file, EXTENSION_ENTRY));
      });
    });
  }
}
