/**
 * Assembles the app directory that the published CLI ships, so that
 * `npx @aparte/bonaparte` can launch the window with nothing but Electron
 * next to it.
 *
 *   packages/cli/app/
 *     package.json          name, version, type: module, main → out/main/index.js
 *     out/                  the electron-vite build of packages/app (main, preload, renderer)
 *     resources/            the icon
 *     plugins/<id>/         plugin.json + dist/ of every built-in plugin
 *
 * Renderer views of the plugins are already bundled into the renderer by
 * `import.meta.glob`; only the Node halves and their manifests travel here.
 * Runs on `prepack`; requires a prior `pnpm build`.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(cliRoot, '..', '..');
const appSource = join(repoRoot, 'packages', 'app');
const target = join(cliRoot, 'app');

// `--clean` (postpack): the assembled copy must not linger in the monorepo,
// or a development launch would pick this stale copy over the live sibling.
if (process.argv.includes('--clean')) {
  rmSync(target, { recursive: true, force: true });
  console.log(`assemble-app: ${target} removed`);
  process.exit(0);
}

const builtMain = join(appSource, 'out', 'main', 'index.js');
if (!existsSync(builtMain)) {
  console.error(`assemble-app: ${builtMain} is missing — run \`pnpm build\` first.`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(join(appSource, 'out'), join(target, 'out'), { recursive: true });
cpSync(join(appSource, 'resources'), join(target, 'resources'), { recursive: true });

const pluginsSource = join(repoRoot, 'plugins');
for (const id of readdirSync(pluginsSource)) {
  const manifest = join(pluginsSource, id, 'plugin.json');
  if (!existsSync(manifest)) continue;
  const dest = join(target, 'plugins', id);
  mkdirSync(dest, { recursive: true });
  cpSync(manifest, join(dest, 'plugin.json'));
  const dist = join(pluginsSource, id, 'dist');
  if (existsSync(dist)) cpSync(dist, join(dest, 'dist'), { recursive: true });
}

const { version } = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
writeFileSync(
  join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'bonaparte-app',
      version,
      private: true,
      type: 'module',
      main: 'out/main/index.js',
    },
    null,
    2,
  ) + '\n',
);

console.log(`assemble-app: ${target} ready (version ${version})`);
