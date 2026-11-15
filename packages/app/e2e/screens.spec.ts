/**
 * Pictures of the screens, for whoever validates them: light and dark, French
 * and English. Not a test of anything. It runs only on request — set
 * `BONAPARTE_SCREENS` to the folder the pictures go to — and is skipped
 * otherwise.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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

// Choosing a model: headers written for the test, on a card said to have 8 Go.
// Their sizes are those of a header, not of a model: the screen is the subject.
const MODELS = {
  'gemma-4-E2B-it-Q4_K_M': { paddingBytes: 2 * 1024 * 1024 },
  'gemma-4-E4B-it-Q4_K_M': { blockCount: 60, embeddingLength: 5376, headCount: 32, headCountKv: 24 },
  'gemma-4-31B-it-Q4_K_M': { blockCount: 60, embeddingLength: 5376, headCount: 32, headCountKv: 48 },
  'gemma-2-9b-it-Q4_K_M': { chatTemplate: "{{ '<start_of_turn>' + role }}" },
};
const CARD = 8 * 1024 ** 3;

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`choosing a model, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const start = locale === 'fr' ? 'Démarrer' : 'Start';

      const listed = await launch({ locale, managed: { models: MODELS, gpuBytes: CARD, releases: true } });
      await listed.page.emulateMedia({ colorScheme: scheme });
      await expect(listed.page.getByRole('button', { name: start })).toBeEnabled();
      await expect(listed.page.locator('.llama-status .aparte-btn')).toBeVisible();
      // Transitions finished: a picture never catches a button half-way to its colour.
      await listed.page.screenshot({ path: join(into, `setup-${locale}-${scheme}.png`), animations: 'disabled' });
      await listed.close();

      const failing = await launch({
        locale,
        managed: { models: MODELS, gpuBytes: CARD },
        env: { FAKE_LLAMA_FAIL: 'failed to load model: unable to allocate CUDA0 buffer' },
      });
      await failing.page.emulateMedia({ colorScheme: scheme });
      await failing.page.getByRole('button', { name: start }).click();
      await expect(failing.page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
      await failing.page.screenshot({ path: join(into, `setup-failed-${locale}-${scheme}.png`), animations: 'disabled' });
      await failing.close();

      const empty = await launch({ locale, managed: { models: {}, releases: true, llama: 'missing' } });
      await empty.page.emulateMedia({ colorScheme: scheme });
      await expect(empty.page.locator('.engine-setup__empty')).toBeVisible();
      await expect(empty.page.locator('.llama-status .aparte-btn')).toBeVisible();
      await empty.page.screenshot({ path: join(into, `setup-empty-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

// The memory of a conversation (phase 3): saved, let go, read again.
const WORDS = {
  fr: {
    start: 'Démarrer',
    new: 'Nouvelle conversation',
    goOn: 'Relire et continuer',
    first: `Peux-tu relire le parseur des heures et me dire ce qui cloche ? ${'Voici ce que j’ai observé jusqu’ici. '.repeat(40)}`,
    second: 'Et pour les fuseaux horaires ?',
    next: 'Continuons.',
  },
  en: {
    start: 'Start',
    new: 'New conversation',
    goOn: 'Re-read and continue',
    first: `Can you read the hours parser again and tell me what is wrong? ${'Here is what I saw so far. '.repeat(40)}`,
    second: 'And the time zones?',
    next: 'Let us go on.',
  },
};

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the memory of a conversation, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = WORDS[locale];
      const launched = await launch({
        locale,
        managed: { models: { 'gemma-4-E4B-it-Q4_K_M': { paddingBytes: 2 * 1024 * 1024 } } },
        env: { FAKE_LLAMA_PREFILL_BATCH: '16', FAKE_LLAMA_PREFILL_PACE_MS: '150' },
      });
      const { page } = launched;
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      const shot = (name: string) =>
        page.screenshot({ path: join(into, `${name}-${locale}-${scheme}.png`), animations: 'disabled' });

      await page.getByRole('button', { name: words.start }).click();
      await expect(ui.editor).toBeVisible({ timeout: 20_000 });
      for (const [text, fresh] of [
        [words.first, false],
        [words.second, true],
      ] as const) {
        if (fresh) await page.getByRole('button', { name: words.new }).click();
        await ui.send(text);
        await expect(ui.replyText).toHaveText('ok', { timeout: 30_000 });
        await expect(ui.streamingReplies).toHaveCount(0);
      }
      await shot('workspace');

      const list = page.locator('aparte-conversation-list');
      const first = list.getByRole('button', { name: new RegExp(`^${words.first.slice(0, 12)}`) });
      await first.click();
      await expect(page.locator('.memory-banner')).toBeVisible();
      await shot('memory-restore');

      // Its memory let go, as the disk budget does.
      await page.getByRole('button', { name: words.new }).click();
      const dir = join(launched.dataDir, 'kv-slots');
      for (const name of (await readdir(dir)).filter((one) => one.endsWith('.slot') && !one.startsWith('seed-'))) {
        const id = name.slice(0, -'.slot'.length);
        await rm(join(dir, name), { force: true });
        await rm(join(dir, `${id}.manifest.json`), { force: true });
        // The note the core's retention leaves: when, under which budget.
        await writeFile(join(dir, `${id}.evicted.json`), JSON.stringify({ at: new Date().toISOString(), budgetBytes: 20 * 1024 ** 3 }));
      }
      await first.click();
      await expect(page.getByRole('button', { name: words.goOn })).toBeVisible();
      await shot('memory-reread');

      await page.getByRole('button', { name: words.goOn }).click();
      await ui.send(words.next);
      await expect(page.locator('.reread-progress')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(600);
      await shot('memory-rereading');
      await expect(ui.streamingReplies).toHaveCount(0, { timeout: 30_000 });
    });
  }
}

// The agent at work (phase 4): a read and an edit waiting for the person, the edit done with its
// change behind its line, a plan in Lecture, a question in the composer's place.
const AGENT = {
  fr: {
    fix: 'Corrige les heures décimales dans la note',
    plan: 'Ajoute un export CSV du récap',
    ask: 'Choisis le séparateur avec moi',
    region: 'Demande d’accord',
    allow: 'Autoriser',
    new: 'Nouvelle conversation',
    done: 'C’est corrigé : 1 h 30 donne maintenant 1,5.',
    planned: 'Voici le plan : je n’écris rien tant que tu ne l’as pas lancé.',
    question: 'Quel séparateur pour le CSV ?',
    options: ['Point-virgule', 'Virgule'],
    steps: ['Écrire toCsv(recap) dans src/recap/csv.ts', 'Ajouter le bouton « Exporter »', 'Lancer la suite de tests'],
    settle: 'Le séparateur : point-virgule ou virgule.',
  },
  en: {
    fix: 'Fix the decimal hours in the note',
    plan: 'Add a CSV export of the recap',
    ask: 'Pick the separator with me',
    region: 'Approval request',
    allow: 'Allow',
    new: 'New conversation',
    done: 'Fixed: 1 h 30 now gives 1.5.',
    planned: 'Here is the plan: nothing is written until you launch it.',
    question: 'Which separator for the CSV?',
    options: ['Semicolon', 'Comma'],
    steps: ['Write toCsv(recap) in src/recap/csv.ts', 'Add the « Export » button', 'Run the test suite'],
    settle: 'The separator: semicolon or comma.',
  },
};

const Q4 = '<|"|>';
const NOTE = 'Récap de la semaine\n- lundi : 7,5 h\n- mardi : 1,3 h (1 h 30)\n- mercredi : 8 h\n';

function agentModel(words: (typeof AGENT)['fr']) {
  const call = (name: string, args: string) => `<|tool_call>call:${name}{${args}}<tool_call|>`;
  const text = (value: string) => `${Q4}${value}${Q4}`;
  return (prompt: string): string => {
    const user = prompt.lastIndexOf('<|turn>user');
    const response = prompt.lastIndexOf('<|tool_response>');
    const asked = prompt.slice(user);
    if (response > user) {
      const said = prompt.slice(response);
      if (said.includes('Plan updated')) return words.planned;
      if (said.includes('Edited')) return words.done;
      if (said.includes('Récap')) return call('edit_file', `path:${text('notes.txt')},old_string:${text('1,3 h')},new_string:${text('1,5 h')}`);
      return 'ok';
    }
    if (prompt.lastIndexOf('[mode] Lecture') > prompt.lastIndexOf('[mode] Plume')) {
      const steps = words.steps.map((step) => `{title:${text(step)},status:${text('pending')}}`).join(',');
      return call(
        'update_plan',
        `title:${text(words.plan)},steps:[${steps}],files:[{path:${text('src/recap/csv.ts')},change:${text('new')}},` +
          `{path:${text('src/ui/RecapHeader.tsx')},change:${text('modified')}}],questions:[${text(words.settle)}]`,
      );
    }
    if (asked.includes('parat')) {
      const options = words.options.map((option) => `{title:${text(option)}}`).join(',');
      return call('ask_user', `questions:[{question:${text(words.question)},header:${text('CSV')},options:[${options}]}]`);
    }
    if (asked.includes(words.fix.slice(0, 8))) return call('read_file', `path:${text('notes.txt')}`);
    return 'ok';
  };
}

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the agent at work, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = AGENT[locale];
      const { page, home } = await launch({ locale, engine: { responder: agentModel(words) } });
      await writeFile(join(home, 'notes.txt'), NOTE);
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      const shot = (name: string) => page.screenshot({ path: join(into, `${name}-${locale}-${scheme}.png`), animations: 'disabled' });

      // A read, then an edit that waits for the person: the card with its diff.
      await ui.send(words.fix);
      const card = page.getByRole('region', { name: words.region });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      await shot('agent-approval');

      // Allowed: the edit is done, its change behind its line.
      await card.getByRole('button', { name: words.allow, exact: true }).click();
      await expect(ui.replyText).toHaveText(words.done, { timeout: 15_000 });
      await page.waitForTimeout(400);
      await shot('agent-done');

      // A plan in Lecture.
      await page.getByRole('button', { name: words.new }).click();
      await page.locator('aparte-approval-mode').getByRole('combobox').click();
      await page.getByRole('option', { name: 'Lecture' }).click();
      await ui.send(words.plan);
      await expect(page.getByRole('region', { name: 'Plan' })).toBeVisible({ timeout: 15_000 });
      await expect(ui.replyText).toHaveText(words.planned, { timeout: 15_000 });
      await page.waitForTimeout(400);
      await shot('agent-plan');

      // A question in the composer's place.
      await page.getByRole('button', { name: words.new }).click();
      await ui.send(words.ask);
      await expect(ui.question).toContainText(words.question, { timeout: 15_000 });
      await page.waitForTimeout(400);
      await shot('agent-question');
    });
  }
}

// « Rechercher » (Ctrl K): two conversations, the words found in the first one.
const SEARCH = {
  fr: { first: 'Le parseur des heures se trompe sur les fuseaux', second: 'Ajouter un export CSV', field: 'Rechercher partout', words: 'parseur', new: 'Nouvelle conversation' },
  en: { first: 'The hour parser gets the time zones wrong', second: 'Add a CSV export', field: 'Search everywhere', words: 'parser', new: 'New conversation' },
};

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`searching, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = SEARCH[locale];
      const { page } = await launch({ locale, engine: { responder: () => 'ok' } });
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      await ui.send(words.first);
      await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
      await page.getByRole('button', { name: words.new }).click();
      await ui.send(words.second);
      await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });

      await page.keyboard.press('Control+K');
      await page.getByRole('combobox', { name: words.field }).fill(words.words);
      await expect(page.getByRole('option').locator('mark').first()).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `search-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}
