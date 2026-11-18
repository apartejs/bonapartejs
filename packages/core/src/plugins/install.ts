/**
 * Adding a plugin (task 11.1): from a folder, from npm, or from a git repository. It is fetched into a staging
 * folder and its manifest read — nothing of it runs: no script of its package (`npm pack --ignore-scripts`), no code
 * of its own — then, once the person has seen what it will be able to do, put under `<data>/plugins/<id>/`. npm's
 * version is pinned when it is added, git's commit noted: a newer one is found and proposed, never put in its place.
 *
 * Every process goes through `spawnHidden`, an argument array, never a shell; what the window typed reaches npm and
 * git only once it cannot be an option (`-…`) nor, for git, a transport that runs a command (`ext::`).
 */

import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseManifest, type PluginManifest, type PluginSource } from '@aparte/bonaparte-shared';
import { tarCommand } from '../engine/llama-install.js';
import { git } from '../git/git.js';
import { resolveCommand } from '../mcp/command.js';
import { spawnHidden, type SpawnFn } from '../process/spawn.js';
import { PLUGIN_MANIFEST_FILE } from './host.js';

/** What the person asked to add, as the dialog has it. */
export type PluginAddRequest = { kind: 'folder'; path: string } | { kind: 'npm'; spec: string } | { kind: 'git'; url: string; ref: string };

export interface PluginPreview {
  /** The staging folder's name: what « Ajouter » refers to. */
  stagingId: string;
  manifest: PluginManifest;
  source: PluginSource;
  /** The version of the plugin of the same id already added, which adding this one replaces. */
  replaces?: string;
}

export type PreviewResult = { ok: true; preview: PluginPreview } | { ok: false; error: string };

export interface PluginInstallerOptions {
  dataDir: string;
  /** The environment npm and git run in: the app's minus its secrets. */
  env: () => Record<string, string>;
  /** Tests only. */
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
}

const STAGING = '.staging';
const RUN_TIMEOUT_MS = 180_000;

interface Staged {
  dir: string;
  manifest: PluginManifest;
  source: PluginSource;
}

export class PluginInstaller {
  private readonly staged = new Map<string, Staged>();

  constructor(private readonly options: PluginInstallerOptions) {}

  /** Where the added plugins live: `<data>/plugins/`. */
  get root(): string {
    return join(this.options.dataDir, 'plugins');
  }

  async preview(request: PluginAddRequest): Promise<PreviewResult> {
    const stagingId = randomUUID();
    const dir = join(this.root, STAGING, stagingId);
    try {
      await mkdir(join(this.root, STAGING), { recursive: true });
      const source = await this.fetch(request, dir);
      const manifest = await readManifest(dir);
      this.staged.set(stagingId, { dir, manifest, source });
      const replaces = await readManifest(join(this.root, manifest.id)).then(
        (before) => before.version,
        () => undefined,
      );
      return { ok: true, preview: { stagingId, manifest, source, ...(replaces ? { replaces } : {}) } };
    } catch (error) {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The plugin staged goes under `<data>/plugins/<id>/`, in place of one of the same id. */
  async install(stagingId: string): Promise<{ id: string; source: PluginSource; dir: string; manifest: PluginManifest }> {
    const staged = this.staged.get(stagingId);
    if (!staged) throw new Error('This plugin is no longer ready to be added: read it again.');
    this.staged.delete(stagingId);
    const target = join(this.root, staged.manifest.id);
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rename(staged.dir, target);
    return { id: staged.manifest.id, source: staged.source, dir: target, manifest: staged.manifest };
  }

  async discard(stagingId: string): Promise<void> {
    const staged = this.staged.get(stagingId);
    this.staged.delete(stagingId);
    await rm(staged?.dir ?? join(this.root, STAGING, stagingId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  /** A plugin removed: its folder goes. */
  async remove(id: string): Promise<void> {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`« ${id} » is not a plugin's id.`);
    await rm(join(this.root, id), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  /** What a staging left behind, an app quit in the middle: nothing of it is kept. */
  async clearStaging(): Promise<void> {
    await rm(join(this.root, STAGING), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }

  /** A newer version of where it came from — npm's latest, git's branch moved on — or none. Nothing is changed. */
  async checkUpdate(source: PluginSource): Promise<string | undefined> {
    if (source.kind === 'npm') {
      const ran = await this.npm(['view', source.name, 'version'], this.options.dataDir);
      const latest = ran.stdout.trim().split(/\s+/).at(-1) ?? '';
      return ran.code === 0 && latest && latest !== source.version ? latest : undefined;
    }
    if (source.kind === 'git') {
      const ran = await git(['-c', 'protocol.ext.allow=never', 'ls-remote', '--', source.url, source.ref], this.options.dataDir);
      const head = ran.stdout.trim().split(/\s+/)[0] ?? '';
      if (ran.code !== 0 || !/^[0-9a-f]{7,64}$/.test(head)) return undefined;
      return head.startsWith(source.commit) || source.commit.startsWith(head) ? undefined : head.slice(0, 12);
    }
    return undefined;
  }

  private async fetch(request: PluginAddRequest, dir: string): Promise<PluginSource> {
    if (request.kind === 'folder') {
      if (!isAbsolute(request.path)) throw new Error('A plugin folder is given by its full path.');
      const found = await stat(request.path).catch(() => null);
      if (!found?.isDirectory()) throw new Error(`There is no folder ${request.path}.`);
      // Its history stays where it was; the rest is copied as it is (its dependencies included).
      await cp(request.path, dir, { recursive: true, filter: (from) => relative(request.path, from).split(/[\\/]/)[0] !== '.git' });
      return { kind: 'folder', path: request.path };
    }
    if (request.kind === 'npm') {
      const spec = request.spec.trim();
      if (!spec || spec.startsWith('-') || /\s/.test(spec)) throw new Error(`« ${request.spec} » is not an npm package.`);
      const unpack = `${dir}.npm`;
      await mkdir(unpack, { recursive: true });
      try {
        const packed = await this.npm(['pack', spec, '--ignore-scripts', '--json', '--pack-destination', unpack], unpack);
        if (packed.code !== 0) throw new Error(`npm could not fetch ${spec}: ${lastLine(packed.stderr)}`);
        const [made] = JSON.parse(packed.stdout) as { name: string; version: string; filename: string }[];
        if (!made) throw new Error(`npm gave nothing for ${spec}.`);
        const tar = tarCommand(this.options.platform ?? process.platform, this.options.env());
        const archive = join(unpack, made.filename.replace(/^@[^/]+\//, '').replace(/\//g, '-'));
        const opened = await this.run(tar, ['-xzf', archive, '-C', unpack], unpack);
        if (opened.code !== 0) throw new Error(`The package of ${spec} could not be opened: ${lastLine(opened.stderr)}`);
        await rename(join(unpack, 'package'), dir);
        return { kind: 'npm', name: made.name, version: made.version };
      } finally {
        await rm(unpack, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
    const url = request.url.trim();
    const ref = request.ref.trim();
    if (!url || url.startsWith('-') || url.includes('::') || /\s/.test(url)) throw new Error(`« ${request.url} » is not an address git can clone.`);
    if (!/^[\w.][\w./-]*$/.test(ref)) throw new Error(`« ${request.ref} » is not a branch nor a tag.`);
    const cloned = await git(['-c', 'protocol.ext.allow=never', 'clone', '--quiet', '--depth', '1', '--branch', ref, '--', url, dir], this.root);
    if (cloned.code !== 0) throw new Error(`git could not clone ${url} at ${ref}: ${lastLine(cloned.stderr)}`);
    const head = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    await rm(join(dir, '.git'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return { kind: 'git', url, ref, commit: head };
  }

  private npm(args: string[], cwd: string): Promise<Ran> {
    const resolved = resolveCommand('npm', args, { env: this.options.env(), ...(this.options.platform ? { platform: this.options.platform } : {}) });
    return this.run(resolved.command, resolved.args, cwd);
  }

  private run(command: string, args: readonly string[], cwd: string): Promise<Ran> {
    return new Promise((done) => {
      let child;
      try {
        child = spawnHidden(command, args, { cwd, env: this.options.env(), stdio: ['ignore', 'pipe', 'pipe'], ...(this.options.spawn ? { spawn: this.options.spawn } : {}) });
      } catch (error) {
        done({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
        return;
      }
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        done({ code: null, stdout, stderr: stderr || error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        done({ code, stdout, stderr });
      });
    });
  }
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

const lastLine = (text: string): string => text.trim().split(/\r?\n/).at(-1) ?? '';

/** The manifest of a plugin's folder, and its halves inside that folder — never a file outside it. */
async function readManifest(dir: string): Promise<PluginManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8'));
  } catch (error) {
    throw new Error(`The plugin has no ${PLUGIN_MANIFEST_FILE} that reads (${error instanceof Error ? error.message : String(error)}).`);
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) throw new Error(`Its ${PLUGIN_MANIFEST_FILE} is not a plugin's manifest: ${parsed.error}`);
  for (const file of [parsed.manifest.entry.node, parsed.manifest.entry.view]) {
    if (!file) continue;
    const at = relative(dir, resolve(dir, file));
    if (at.startsWith('..') || isAbsolute(at)) throw new Error(`Its file ${file} is outside its folder.`);
  }
  return parsed.manifest;
}
