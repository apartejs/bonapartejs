/**
 * The app as electron-builder packs it (task 13.2): what runs from `out/` under Electron must run from the archive —
 * a reply streams, the terminal's native module loads from outside the archive, the icons are found. Run after
 * `pnpm dist:dir`; skipped when nothing is packed.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const packed = join(import.meta.dirname, '..', 'dist', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked', process.platform === 'win32' ? 'bonaparte.exe' : 'bonaparte');
// The release workflow packs first: there, nothing packed is a failure, never a skipped test.
const nothingPacked = !existsSync(packed) && process.env['BONAPARTE_PACKED_REQUIRED'] !== '1';

test('the packed app carries the Visual C++ runtime llama.cpp needs, outside the archive', () => {
  test.skip(nothingPacked, 'nothing packed: run `pnpm dist:dir` first');
  test.skip(process.platform !== 'win32', 'the runtime is Windows’');
  // llama.cpp, a program of its own, copies it from the disk: never from app.asar.
  const runtime = join(packed, '..', 'resources', 'app.asar.unpacked', 'resources', 'vcruntime');
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'NOTICE.txt']) {
    expect(existsSync(join(runtime, name)), name).toBe(true);
  }
});

test('the packed app answers, and its terminal runs a shell', async ({ launch }) => {
  test.skip(nothingPacked, 'nothing packed: run `pnpm dist:dir` first');
  const { app, page } = await launch({ executable: packed, engine: { responder: () => 'Bonjour Paul' } });
  expect(await app.evaluate(({ app: electron }) => electron.isPackaged)).toBe(true);
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replies.last()).toContainText('Bonjour Paul', { timeout: 15_000 });

  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Terminaux' });
  const first = tabs.getByRole('tab').first();
  await expect(first).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const name = (await first.textContent())!.trim();
  const output = page.getByRole('log', { name: `Sortie du terminal ${name}` });
  await output.click();
  await page.keyboard.type('echo bonaparte-packed');
  await page.keyboard.press('Enter');
  await expect(output).toContainText('bonaparte-packed', { timeout: 20_000 });
});
