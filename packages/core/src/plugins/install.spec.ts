/**
 * Adding a plugin (task 11.1): from a folder, from npm (its version pinned when it is added), or from git (an
 * address, and a branch or a tag). Its manifest is read before anything of it runs — no script of its package, no
 * code of its own — then it is put under `<data>/plugins/<id>/`. A newer version is found and proposed, never put
 * in its place. No test asks the internet: npm packs a local folder, git clones a temporary repository.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git/git.js';
import type { SpawnFn } from '../process/spawn.js';
import { spawnHidden } from '../process/spawn.js';
import { tempRepo, type TempRepo } from '../testing/temp-repo.js';
import { PluginInstaller } from './install.js';

const dirs: string[] = [];
const repos: TempRepo[] = [];
afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => repo.remove()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const MANIFEST = {
  id: 'revue-pr',
  name: 'Revue PR',
  version: '0.3.0',
  entry: { node: 'index.mjs' },
  effects: [{ effect: 'network', what: 'api.github.com' }],
  contributes: { tools: [{ name: 'review_pr', description: 'Sum up a pull request.', effect: 'network' }] },
};

/** A plugin's folder whose code, were it run, would leave a mark. */
async function pluginFolder(extra: Record<string, string> = {}, manifest: unknown = MANIFEST): Promise<{ dir: string; mark: string }> {
  const dir = await temp('bp-plugin-src-');
  const mark = join(dir, 'RAN');
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'index.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(mark)}, 'ran');\nexport default {};\n`);
  for (const [name, text] of Object.entries(extra)) await writeFile(join(dir, name), text);
  return { dir, mark };
}

async function installer() {
  const data = await temp('bp-plugin-data-');
  return { data, plugins: new PluginInstaller({ dataDir: data, env: () => ({ ...process.env }) as Record<string, string> }) };
}

describe('adding a plugin from a folder (task 11.1)', () => {
  it('its manifest is read and shown, nothing of it runs, and it lands under <data>/plugins/<id>/ only once added', async () => {
    const { dir, mark } = await pluginFolder();
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    const { data, plugins } = await installer();
    const preview = await plugins.preview({ kind: 'folder', path: dir });
    expect(preview).toMatchObject({ ok: true, preview: { manifest: { id: 'revue-pr', version: '0.3.0' }, source: { kind: 'folder', path: dir } } });
    expect(existsSync(join(data, 'plugins', 'revue-pr'))).toBe(false);
    if (!preview.ok) return;
    const added = await plugins.install(preview.preview.stagingId);
    expect(added).toMatchObject({ id: 'revue-pr', source: { kind: 'folder', path: dir } });
    expect(JSON.parse(await readFile(join(data, 'plugins', 'revue-pr', 'plugin.json'), 'utf8'))).toMatchObject({ id: 'revue-pr' });
    expect(existsSync(join(data, 'plugins', 'revue-pr', 'index.mjs'))).toBe(true);
    // Its history stays where it was.
    expect(existsSync(join(data, 'plugins', 'revue-pr', '.git'))).toBe(false);
    expect(existsSync(mark)).toBe(false);
  });

  it('a manifest that does not read says where; a code file outside its folder is refused', async () => {
    const { plugins } = await installer();
    const bad = await pluginFolder({}, { ...MANIFEST, effects: [] });
    expect(await plugins.preview({ kind: 'folder', path: bad.dir })).toMatchObject({ ok: false, error: expect.stringMatching(/contributes\.tools\.0\.effect/) });
    const escaping = await pluginFolder({}, { ...MANIFEST, entry: { node: '../outside.mjs' } });
    expect(await plugins.preview({ kind: 'folder', path: escaping.dir })).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
    const none = await temp('bp-plugin-empty-');
    expect(await plugins.preview({ kind: 'folder', path: none })).toMatchObject({ ok: false, error: expect.stringMatching(/plugin\.json/) });
  });

  it('a preview let go leaves nothing; a plugin added again replaces the one before; removed, its folder goes', async () => {
    const { dir } = await pluginFolder();
    const { data, plugins } = await installer();
    const first = await plugins.preview({ kind: 'folder', path: dir });
    if (!first.ok) throw new Error(first.error);
    await plugins.discard(first.preview.stagingId);
    expect(existsSync(join(data, 'plugins', '.staging', first.preview.stagingId))).toBe(false);

    const again = await plugins.preview({ kind: 'folder', path: dir });
    if (!again.ok) throw new Error(again.error);
    await plugins.install(again.preview.stagingId);
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ ...MANIFEST, version: '0.4.0' }));
    const newer = await plugins.preview({ kind: 'folder', path: dir });
    if (!newer.ok) throw new Error(newer.error);
    expect(newer.preview.replaces).toBe('0.3.0');
    await plugins.install(newer.preview.stagingId);
    expect(JSON.parse(await readFile(join(data, 'plugins', 'revue-pr', 'plugin.json'), 'utf8')).version).toBe('0.4.0');
    await plugins.remove('revue-pr');
    expect(existsSync(join(data, 'plugins', 'revue-pr'))).toBe(false);
  });
});

describe('adding a plugin from npm (task 11.1)', () => {
  it('npm packs it — no script of the package runs — and its version is pinned', async () => {
    const { dir, mark } = await pluginFolder({
      'package.json': JSON.stringify({ name: 'revue-pr', version: '0.3.0', scripts: { prepare: 'node index.mjs' }, files: ['plugin.json', 'index.mjs'] }),
    });
    const { data, plugins } = await installer();
    // A folder is a package npm can pack without the network: the real npm, the real archive.
    const preview = await plugins.preview({ kind: 'npm', spec: dir });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.preview.source).toEqual({ kind: 'npm', name: 'revue-pr', version: '0.3.0' });
    expect(existsSync(mark)).toBe(false);
    await plugins.install(preview.preview.stagingId);
    expect(existsSync(join(data, 'plugins', 'revue-pr', 'index.mjs'))).toBe(true);
    expect(existsSync(join(data, 'plugins', 'revue-pr', 'package', 'plugin.json'))).toBe(false);
  }, 120_000);

  it('a spec that is an option is refused before npm runs', async () => {
    const { plugins } = await installer();
    expect(await plugins.preview({ kind: 'npm', spec: '--registry=https://evil.example' })).toMatchObject({ ok: false, error: expect.stringMatching(/package/) });
  });
});

describe('adding a plugin from git (task 11.1)', () => {
  it('cloned at its branch or tag, its commit noted, its history left behind', async () => {
    const repo = await tempRepo({ 'plugin.json': JSON.stringify(MANIFEST), 'index.mjs': 'export default {};\n' });
    repos.push(repo);
    const { data, plugins } = await installer();
    const preview = await plugins.preview({ kind: 'git', url: repo.dir, ref: 'main' });
    if (!preview.ok) throw new Error(preview.error);
    const head = (await git(['rev-parse', 'HEAD'], repo.dir)).stdout.trim();
    expect(preview.preview.source).toEqual({ kind: 'git', url: repo.dir, ref: 'main', commit: head });
    await plugins.install(preview.preview.stagingId);
    expect(existsSync(join(data, 'plugins', 'revue-pr', 'plugin.json'))).toBe(true);
    expect(existsSync(join(data, 'plugins', 'revue-pr', '.git'))).toBe(false);
  }, 60_000);

  it('an address that is an option, or a transport that runs a command, is refused before git runs', async () => {
    const { plugins } = await installer();
    expect(await plugins.preview({ kind: 'git', url: '--upload-pack=calc', ref: 'main' })).toMatchObject({ ok: false });
    expect(await plugins.preview({ kind: 'git', url: 'ext::sh -c calc', ref: 'main' })).toMatchObject({ ok: false });
    expect(await plugins.preview({ kind: 'git', url: 'https://example.com/x.git', ref: '--orphan' })).toMatchObject({ ok: false });
  });
});

describe('an update (task 11.1)', () => {
  it('npm: a newer version is found and proposed — the plugin is not changed', async () => {
    const asked: string[][] = [];
    const spawn: SpawnFn = (command, args, options) => {
      asked.push([command, ...args]);
      return spawnHidden(process.execPath, ['-e', 'console.log("0.4.0")'], options as never);
    };
    const data = await temp('bp-plugin-data-');
    const plugins = new PluginInstaller({ dataDir: data, env: () => ({ ...process.env }) as Record<string, string>, spawn });
    expect(await plugins.checkUpdate({ kind: 'npm', name: 'revue-pr', version: '0.3.0' })).toBe('0.4.0');
    expect(asked.at(-1)!.slice(-3)).toEqual(['view', 'revue-pr', 'version']);
    expect(await plugins.checkUpdate({ kind: 'npm', name: 'revue-pr', version: '0.4.0' })).toBeUndefined();
  });

  it('git: a new commit on its branch is found and proposed', async () => {
    const repo = await tempRepo({ 'plugin.json': JSON.stringify(MANIFEST) });
    repos.push(repo);
    const { plugins } = await installer();
    const head = (await git(['rev-parse', 'HEAD'], repo.dir)).stdout.trim();
    expect(await plugins.checkUpdate({ kind: 'git', url: repo.dir, ref: 'main', commit: head })).toBeUndefined();
    await mkdir(join(repo.dir, 'more'), { recursive: true });
    await writeFile(join(repo.dir, 'more', 'x.txt'), 'x');
    await git(['add', '-A'], repo.dir);
    await git(['commit', '-q', '-m', 'second'], repo.dir);
    const next = (await git(['rev-parse', 'HEAD'], repo.dir)).stdout.trim();
    expect(await plugins.checkUpdate({ kind: 'git', url: repo.dir, ref: 'main', commit: head })).toBe(next.slice(0, 12));
  }, 60_000);
});
