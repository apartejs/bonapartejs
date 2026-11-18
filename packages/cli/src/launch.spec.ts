import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronNeedsDownload, launchFromCli, resolveAppDir, type LaunchDeps } from './launch.js';

const ROOT = join('/pkg', 'bonaparte');
const built = (dir: string) => [join(dir, 'package.json'), join(dir, 'out', 'main', 'index.js')];

describe('resolveAppDir (task 13.3)', () => {
  it('prefers the app shipped in the package', () => {
    const files = new Set([...built(join(ROOT, 'app')), ...built(join(ROOT, '..', 'app'))]);
    expect(resolveAppDir(ROOT, (path) => files.has(path))).toBe(join(ROOT, 'app'));
  });

  it('falls back on the app beside it in the repository', () => {
    const files = new Set(built(join(ROOT, '..', 'app')));
    expect(resolveAppDir(ROOT, (path) => files.has(path))).toBe(join(ROOT, '..', 'app'));
  });

  it('a folder without its built main is no app', () => {
    const files = new Set([join(ROOT, 'app', 'package.json')]);
    expect(resolveAppDir(ROOT, (path) => files.has(path))).toBeNull();
  });
});

describe('electronNeedsDownload (task 13.3)', () => {
  const dir = join('/e', 'electron');
  it('without path.txt: to download', () => {
    expect(electronNeedsDownload(dir, () => null, () => false)).toBe(true);
  });
  it('a path.txt naming a binary that is not there: to download', () => {
    expect(electronNeedsDownload(dir, () => 'electron.exe', () => false)).toBe(true);
  });
  it('the binary there: nothing to download', () => {
    expect(electronNeedsDownload(dir, () => 'electron.exe', (path) => path === join(dir, 'dist', 'electron.exe'))).toBe(false);
  });
});

function rig(over: Partial<LaunchDeps> = {}) {
  const said: string[] = [];
  const launched: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  let downloads = 0;
  let unrefs = 0;
  const appDir = join(ROOT, 'app');
  const files = new Set([...built(appDir), join('/e', 'electron', 'dist', 'electron.exe')]);
  const deps: LaunchDeps = {
    packageRoot: ROOT,
    exists: (path) => files.has(path),
    readPathTxt: () => 'electron.exe',
    electronDir: () => join('/e', 'electron'),
    installElectron: async () => {
      downloads += 1;
    },
    electronBinary: () => join('/e', 'electron', 'dist', 'electron.exe'),
    env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' },
    spawn: (command, args, options) => {
      launched.push({ command, args, env: options.env ?? {} });
      return {
        unref: () => {
          unrefs += 1;
        },
        once: () => undefined,
        pid: 42,
      } as never;
    },
    say: (line) => said.push(line),
    words: { appNotBuilt: 'no app', electronMissing: 'no electron', downloadingElectron: 'downloading electron', launched: 'launched' },
    ...over,
  };
  return { deps, said, launched, appDir, downloads: () => downloads, unrefs: () => unrefs };
}

describe('launchFromCli (task 13.3)', () => {
  it('launches Electron on the app, without ELECTRON_RUN_AS_NODE, and lets the terminal go', async () => {
    const { deps, launched, appDir, said, unrefs } = rig();
    expect(await launchFromCli(deps)).toBe(0);
    expect(launched).toEqual([{ command: join('/e', 'electron', 'dist', 'electron.exe'), args: [appDir], env: { PATH: 'x' } }]);
    expect(unrefs()).toBe(1);
    expect(said).toEqual(['launched']);
  });

  it('says that Electron is downloaded before it is', async () => {
    const order: string[] = [];
    const { deps } = rig({
      readPathTxt: () => null,
      installElectron: async () => {
        order.push('download');
      },
      say: (line) => order.push(line),
    });
    expect(await launchFromCli(deps)).toBe(0);
    expect(order.slice(0, 2)).toEqual(['downloading electron', 'download']);
  });

  it('a source tree that is not built is said, and nothing launches', async () => {
    const { deps, launched, said } = rig({ exists: () => false });
    expect(await launchFromCli(deps)).toBe(1);
    expect(launched).toEqual([]);
    expect(said).toEqual(['no app']);
  });

  it('without Electron, said, and nothing launches', async () => {
    const { deps, launched, said } = rig({ electronDir: () => null });
    expect(await launchFromCli(deps)).toBe(1);
    expect(launched).toEqual([]);
    expect(said).toEqual(['no electron']);
  });
});

describe('the package of the command (task 13.3)', () => {
  const read = (path: string) =>
    JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    };
  const cli = read('../package.json');
  const app = read('../../app/package.json');

  it('depends on what the app needs at run time, at the same versions, and on its Electron', () => {
    for (const [name, version] of Object.entries(app.dependencies ?? {})) {
      expect(cli.dependencies?.[name], name).toBe(version);
    }
    expect(cli.dependencies?.['electron']).toBe(app.devDependencies?.['electron']);
  });

  it('ships the app it assembles before it is packed, and removes it after', () => {
    expect(cli.files).toContain('app');
    expect(cli.scripts?.['prepack']).toMatch(/assemble-app\.mjs$/);
    expect(cli.scripts?.['postpack']).toMatch(/assemble-app\.mjs --clean$/);
  });
});
