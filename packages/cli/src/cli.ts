/**
 * The `bonaparte` command. With no argument it launches the app it ships
 * (task 13.3). Its doctor is the core's: the same search for llama.cpp as a
 * load, the same measure of the card, on the app's own data folder — and it
 * loads nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bonaparteDataDir, createCore, spawnHidden, spawnWindowed } from '@aparte/bonaparte-core';
import { launchFromCli } from './launch.js';
import { localeOf, main } from './main.js';
import { en } from './messages/en.js';
import { fr } from './messages/fr.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
const require = createRequire(import.meta.url);
const locale = localeOf(process.env);

const code = await main(process.argv.slice(2), {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
  locale,
  version: pkg.version,
  color: process.stdout.isTTY === true,
  doctor: async () => {
    const core = createCore({ dataDir: bonaparteDataDir(), env: process.env, logger: () => undefined });
    try {
      return await core.doctor();
    } finally {
      await core.stop();
    }
  },
  launch: () =>
    launchFromCli({
      packageRoot,
      exists: existsSync,
      readPathTxt: (path) => {
        try {
          return readFileSync(path, 'utf8');
        } catch {
          return null;
        }
      },
      electronDir: () => {
        try {
          return dirname(require.resolve('electron/package.json'));
        } catch {
          return null;
        }
      },
      // Electron's own install script, run by this Node with an argument array: its download, said first.
      installElectron: (electronDir) =>
        new Promise<void>((resolve, reject) => {
          const child = spawnHidden(process.execPath, [join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit' });
          child.once('error', reject);
          child.once('exit', (exit) => (exit === 0 ? resolve() : reject(new Error(`Electron's download ended with ${exit}`))));
        }),
      electronBinary: (electronDir) => join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim()),
      env: process.env,
      spawn: (command, args, options) => spawnWindowed(command, args, options),
      say: (line) => console.log(line),
      words: (locale === 'fr' ? fr : en).launch,
    }),
});
process.exitCode = code;
