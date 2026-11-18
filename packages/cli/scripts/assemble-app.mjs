/**
 * Before the command is packed (task 13.3): the built app goes into `app/`,
 * which the package ships — electron-vite's `out/` (the workspace bundled in
 * it, the plugins' processes with it) and the icons the main process reads.
 * `--clean`, after it is packed: `app/` goes away, lest a stale copy be
 * launched instead of the app built beside it in the repository.
 *
 * Run `pnpm build` first: a package without its app would launch nothing.
 */

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'app');
const source = join(root, '..', 'app');

await rm(target, { recursive: true, force: true });
if (process.argv.includes('--clean')) process.exit(0);

const main = join(source, 'out', 'main', 'index.js');
try {
  await stat(main);
} catch {
  console.error(`The app is not built (${main} is missing): run \`pnpm build\` first.`);
  process.exit(1);
}

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await mkdir(target, { recursive: true });
await cp(join(source, 'out'), join(target, 'out'), { recursive: true, filter: (path) => !path.endsWith('.map') });
await cp(join(source, 'resources'), join(target, 'resources'), { recursive: true });
await writeFile(
  join(target, 'package.json'),
  `${JSON.stringify({ name: 'bonaparte-app', productName: 'bonaparte', version, private: true, type: 'module', main: 'out/main/index.js' }, null, 2)}\n`,
);
console.log(`bonaparte ${version}: the app assembled in ${target}`);
