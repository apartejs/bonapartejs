/**
 * Pictures of the screens, for whoever validates them: light and dark, French
 * and English. Not a test of anything. It runs only on request — set
 * `BONAPARTE_SCREENS` to the folder the pictures go to — and is skipped
 * otherwise.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const folder = process.env['BONAPARTE_SCREENS'];

// What a coding agent answers: some reasoning, a link to a file, two blocks of code.
const REPLY = [
  '<|channel>thought\nIl demande la version : elle est dans package.json.<channel|>',
  'La version est dans [package.json](package.json), sous la clé `version` :',
  '',
  '```json',
  '{',
  '  "name": "spanwise",',
  '  "version": "0.4.2"',
  '}',
  '```',
  '',
  'Pour la lire dans un script :',
  '',
  '```ts',
  "import { readFileSync } from 'node:fs';",
  '',
  "const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };",
  'console.log(version);',
  '```',
].join('\n');

const QUESTION = { fr: 'Quelle est la version du projet ?', en: 'What is the version of the project?' };

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the first screen, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });

      const { page } = await launch({ locale, engine: { responder: () => REPLY } });
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);

      await expect(ui.editor).toBeVisible();
      await page.screenshot({ path: join(into, `chat-empty-${locale}-${scheme}.png`) });

      await ui.send(QUESTION[locale]);
      await expect(page.locator('aparte-chat-bubble[data-role="assistant"] pre').first()).toBeVisible();
      await expect(ui.streamingReplies).toHaveCount(0);
      // The highlighter colours the code once the reply has settled.
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(into, `chat-reply-${locale}-${scheme}.png`) });
    });
  }
}
