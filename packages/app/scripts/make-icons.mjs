/**
 * Draws the icons of the notification area and of the taskbar's badge (task 8.5) from the colours of
 * `tokens.css`, into `resources/icons/`, where the main process reads them. The PNGs are versioned; a test
 * (`src/main/icons/draw.spec.ts`) checks they are still what the tokens give. Run it after changing a
 * `--bonaparte-tray-*` token:
 *
 *   node scripts/make-icons.mjs        (from packages/app)
 *
 * Node runs the TypeScript it imports as it is (types only).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { iconSet, readTokens } from '../src/main/icons/draw.ts';

const app = join(import.meta.dirname, '..');
const tokens = readTokens(await readFile(join(app, 'src', 'renderer', 'src', 'theme', 'tokens.css'), 'utf8'));
const into = join(app, 'resources', 'icons');
await mkdir(into, { recursive: true });
const icons = iconSet(tokens);
for (const [name, png] of icons) await writeFile(join(into, name), png);
console.log(`${icons.size} icons written into resources/icons`);
