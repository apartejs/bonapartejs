/**
 * Pictures of the screens, for whoever validates them: light and dark, French
 * and English. Not a test of anything. It runs only on request — set
 * `BONAPARTE_SCREENS` to the folder the pictures go to — and is skipped
 * otherwise.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FAKE_QWEN_TEMPLATE, tempRepo } from '@aparte/bonaparte-core/testing';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { diffView } from './fixtures/diff.js';

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

// The shell (task 5.6): a project with two conversations, one without project, the memory of each said.
const SHELL = {
  fr: { start: 'Démarrer', composer: 'Réponds, ou demande autre chose…', newProject: 'Nouveau projet', choose: 'Choisir un dossier…', create: 'Créer le projet', fold: 'Réduire la barre latérale', first: 'Corriger les heures décimales', second: 'Migrer le parseur vers zod', other: 'Les slots de llama.cpp', new: 'Nouvelle conversation' },
  en: { start: 'Start', composer: 'Reply, or ask something else…', newProject: 'New project', choose: 'Choose a folder…', create: 'Create the project', fold: 'Fold the sidebar', first: 'Fix the decimal hours', second: 'Move the parser to zod', other: 'The slots of llama.cpp', new: 'New conversation' },
};

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the shell, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = SHELL[locale];
      const project = join(into, `spanwise-${locale}-${scheme}`);
      await rm(project, { recursive: true, force: true });
      await mkdir(project, { recursive: true });
      const { app, page } = await launch({
        locale,
        managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } } },
        env: { BONAPARTE_E2E_PICK_FOLDER: project },
      });
      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole('button', { name: words.start }).click();
      await expect(chat(page).composer(words.composer)).toBeVisible({ timeout: 20_000 });
      const ask = async (text: string): Promise<void> => {
        const before = await chat(page).replies.count();
        await chat(page).send(text);
        await expect(chat(page).replies).toHaveCount(before + 1, { timeout: 15_000 });
        await expect(chat(page).streamingReplies).toHaveCount(0, { timeout: 15_000 });
      };
      await ask(words.other);
      await page.getByRole('button', { name: words.newProject }).click();
      await page.getByRole('button', { name: words.choose }).click();
      await page.getByRole('button', { name: words.create }).click();
      await expect(chat(page).userMessages).toHaveCount(0);
      await ask(words.second);
      await page.getByRole('button', { name: words.new }).first().click();
      await expect(chat(page).userMessages).toHaveCount(0);
      await ask(words.first);
      await page.waitForTimeout(600);
      const shot = (name: string) => page.screenshot({ path: join(into, `${name}-${locale}-${scheme}.png`), animations: 'disabled' });
      await shot('shell');
      await page.keyboard.press('Control+B');
      await page.waitForTimeout(300);
      await shot('shell-folded');
      await page.keyboard.press('Control+B');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 760));
      await page.waitForTimeout(400);
      await shot('shell-narrow');
    });
  }
}

// The settings (task 5.7): « Général » and « Apparence ».
const SETTINGS = { fr: { open: 'Réglages', appearance: 'Apparence', nav: 'Réglages' }, en: { open: 'Settings', appearance: 'Appearance', nav: 'Settings' } };

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the settings, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = SETTINGS[locale];
      const { page } = await launch({ locale, engine: { responder: () => 'ok' } });
      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole('button', { name: words.open, exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `settings-general-${locale}-${scheme}.png`), animations: 'disabled' });
      await page.getByRole('navigation', { name: words.nav }).getByRole('link', { name: words.appearance }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `settings-appearance-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

// Settings, Engine and memory, and Models (task 5.7): a managed engine, two conversations.
for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the engine and the models, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = locale === 'fr'
        ? { start: 'Démarrer', composer: 'Réponds, ou demande autre chose…', new: 'Nouvelle conversation', open: 'Réglages', engine: 'Moteur et mémoire', models: 'Modèles', first: 'Corriger les heures décimales', second: 'Migrer le parseur vers zod' }
        : { start: 'Start', composer: 'Reply, or ask something else…', new: 'New conversation', open: 'Settings', engine: 'Engine and memory', models: 'Models', first: 'Fix the decimal hours', second: 'Move the parser to zod' };
      const { page } = await launch({ locale, managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 }, 'gemma-4-31B-it-Q4_K_M': { blockCount: 60, embeddingLength: 5376, headCount: 32, headCountKv: 48 } } } });
      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole('button', { name: words.start }).first().click();
      await expect(chat(page).composer(words.composer)).toBeVisible({ timeout: 20_000 });
      for (const [index, text] of [words.first, words.second].entries()) {
        if (index > 0) {
          await page.getByRole('button', { name: words.new }).first().click();
          await expect(chat(page).userMessages).toHaveCount(0);
        }
        await chat(page).send(text);
        await expect(chat(page).streamingReplies).toHaveCount(0, { timeout: 15_000 });
        await expect(chat(page).replies).toHaveCount(1, { timeout: 15_000 });
      }
      await page.getByRole('button', { name: words.open, exact: true }).click();
      const nav = page.getByRole('navigation', { name: words.open });
      await nav.getByRole('link', { name: words.engine }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `settings-engine-${locale}-${scheme}.png`), animations: 'disabled' });
      await nav.getByRole('link', { name: words.models }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `settings-models-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the panes, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = locale === 'fr'
        ? { group: 'Volets', files: 'Fichiers', changes: 'Changements', terminal: 'Terminal', ask: 'Corrige le format des heures', tree: 'Fichiers du projet' }
        : { group: 'Panes', files: 'Files', changes: 'Changes', terminal: 'Terminal', ask: 'Fix the hours format', tree: 'Project files' };
      const Q = '<|"|>';
      const edit = `<|tool_call>call:edit_file{path:${Q}src/format.ts${Q},old_string:${Q}minutes / 100${Q},new_string:${Q}minutes / 60${Q}}<tool_call|>`;
      const done = locale === 'fr' ? 'Corrigé : une vraie division par 60. Relis le diff et dis-moi.' : 'Fixed: a real division by 60. Read the diff and tell me.';
      const { page, home } = await launch({
        locale,
        engine: { responder: (prompt: string) => (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? done : edit) },
        settings: { defaultMode: 'plume' },
      });
      await mkdir(join(home, 'src'), { recursive: true });
      await writeFile(join(home, 'src', 'format.ts'), 'export function toDecimal(hours: number, minutes: number): number {\n  return hours + minutes / 100;\n}\n');
      await writeFile(join(home, 'AGENTS.md'), '# spanwise\n');
      await page.emulateMedia({ colorScheme: scheme });
      await chat(page).send(words.ask);
      await expect(chat(page).replyText).toHaveText(done, { timeout: 15_000 });
      const toggles = page.getByRole('group', { name: words.group });
      await toggles.getByRole('button', { name: words.changes, exact: true }).click();
      await toggles.getByRole('button', { name: words.terminal, exact: true }).click();
      await expect(page.getByRole('tablist').getByRole('tab').first()).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(into, `panes-changes-terminal-${locale}-${scheme}.png`), animations: 'disabled' });
      await toggles.getByRole('button', { name: words.terminal, exact: true }).click();
      await toggles.getByRole('button', { name: words.files, exact: true }).click();
      const tree = page.getByRole('tree', { name: words.tree });
      await tree.getByRole('treeitem', { name: /^src/ }).click();
      await tree.getByRole('treeitem', { name: /^format\.ts/ }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `panes-files-changes-${locale}-${scheme}.png`), animations: 'disabled' });
    });

    // A conversation of a git project on its own branch, its pull request read, its diff commented.
    test(`a conversation on its own branch, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words =
        locale === 'fr'
          ? {
              newProject: 'Nouveau projet',
              choose: 'Choisir un dossier…',
              git: 'Un dépôt git, sur main',
              create: 'Créer le projet',
              where: 'Où travaille la conversation',
              own: /Sur sa propre branche/,
              branch: 'Branche',
              ask: 'Corrige le format des heures',
              done: 'Corrigé sur la branche : une vraie division par 60. Relis le diff.',
              group: 'Volets',
              changes: 'Changements',
              comments: ['Garde la division entière pour les minutes.', 'Ajoute un test pour 90 minutes.'],
            }
          : {
              newProject: 'New project',
              choose: 'Choose a folder…',
              git: 'A git repository, on main',
              create: 'Create the project',
              where: 'Where the conversation works',
              own: /On its own branch/,
              branch: 'Branch',
              ask: 'Fix the hours format',
              done: 'Fixed on the branch: a real division by 60. Read the diff.',
              group: 'Panes',
              changes: 'Changes',
              comments: ['Keep the integer division for the minutes.', 'Add a test for 90 minutes.'],
            };
      const repo = await tempRepo({
        'src/format.ts': 'export function toDecimal(hours: number, minutes: number): number {\n  return hours + minutes / 100;\n}\n',
        'AGENTS.md': '# spanwise\n',
      });
      try {
        const Q = '<|"|>';
        const edit = `<|tool_call>call:edit_file{path:${Q}src/format.ts${Q},old_string:${Q}minutes / 100${Q},new_string:${Q}minutes / 60${Q}}<tool_call|>`;
        const { page } = await launch({
          locale,
          engine: { responder: (prompt: string) => (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? words.done : edit) },
          env: { BONAPARTE_E2E_PICK_FOLDER: repo.dir },
          gh: { pr: { number: 42, url: 'https://github.com/example/spanwise/pull/42', state: 'OPEN', statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }] } },
        });
        await page.emulateMedia({ colorScheme: scheme });
        await page.getByRole('button', { name: words.newProject }).click();
        const dialog = page.getByRole('dialog', { name: words.newProject });
        await dialog.getByRole('button', { name: words.choose }).click();
        await expect(dialog).toContainText(words.git);
        await dialog.getByRole('radio', { name: /Plume/ }).check();
        await dialog.getByRole('button', { name: words.create }).click();
        await page.getByRole('radiogroup', { name: words.where }).getByRole('radio', { name: words.own }).check();
        await page.getByRole('textbox', { name: words.branch }).fill('bonaparte/heures');
        await chat(page).send(words.ask);
        await expect(chat(page).replyText).toHaveText(words.done, { timeout: 15_000 });
        await expect(page.locator('.conversation-header')).toContainText('PR 42', { timeout: 10_000 });
        await page.getByRole('group', { name: words.group }).getByRole('button', { name: words.changes, exact: true }).click();
        const file = diffView(page.getByRole('region', { name: words.changes, exact: true }).getByRole('region', { name: 'src/format.ts', exact: true }));
        for (const [index, text] of words.comments.entries()) {
          await file.lineNumber('new', index + 2).click();
          await file.commentField.fill(text);
          await file.commentField.press('Control+Enter');
        }
        await expect(file.comments).toHaveCount(2);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(into, `branch-review-${locale}-${scheme}.png`), animations: 'disabled' });
      } finally {
        await repo.remove();
      }
    });
  }
}

// ── Phase 7: going back, the branches, compaction, the costs said ──

const PHASE7 = {
  fr: {
    first: 'Renomme formatHours en formatWeek.',
    second: 'Ajoute aussi un export CSV.',
    back: 'Revenir avant',
    confirm: 'Revenir',
    branch: 'Brancher',
    picker: 'Modèle',
    cancel: 'Annuler',
    settings: 'Réglages',
    engine: 'Moteur et mémoire',
    cache: 'Cache K/V',
    unload: 'Décharger',
    conversations: 'Conversations',
    start: 'Démarrer',
    full: 'Message numéro 1.',
    compact: /^Compacter/,
  },
  en: {
    first: 'Rename formatHours to formatWeek.',
    second: 'Also add a CSV export.',
    back: 'Go back before',
    confirm: 'Go back',
    branch: 'Branch',
    picker: 'Model',
    cancel: 'Cancel',
    settings: 'Settings',
    engine: 'Engine and memory',
    cache: 'K/V cache',
    unload: 'Unload',
    conversations: 'Conversations',
    start: 'Start',
    full: 'Message number 1.',
    compact: /^Compact/,
  },
} as const;

/** A reply that brings the conversation to 92 % of its window, as the engine counts it (the fake one: four characters a token). */
function filling(nCtx: number) {
  return (prompt: string): string => {
    if (prompt.includes('Summarize this conversation so far')) return 'Facts:\nThe hours are decimal.\nWork:\nThe format of the hours was fixed.';
    const room = Math.floor(0.92 * nCtx - Math.ceil(prompt.length / 4));
    return 'Une longue réponse sur le travail fait. '.repeat(Math.max(1, Math.floor((room * 4) / 40)));
  };
}

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the context nearly full, and compacted, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = PHASE7[locale];
      const { page } = await launch({ locale, engine: { responder: filling(8192), nCtx: 8192 } });
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      await ui.send(words.full);
      await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('.context-banner')).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: join(into, `context-full-${locale}-${scheme}.png`) });
      await page.locator('.context-banner').getByRole('button', { name: words.compact }).click();
      await expect(page.locator('.context-banner')).toBeHidden({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(into, `compacted-${locale}-${scheme}.png`) });
    });

    test(`going back, the branches and the costs said, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = PHASE7[locale];
      const { page } = await launch({
        locale,
        managed: {
          models: {
            'gemma-4-26B-A4B-it-Q4_K_M': { paddingBytes: 3 * 1024 * 1024 },
            'Qwen3-1.7B-Q4_K_M': { architecture: 'qwen3', chatTemplate: FAKE_QWEN_TEMPLATE, paddingBytes: 1024 * 1024 },
          },
        },
      });
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      await page.getByRole('button', { name: words.start }).click();
      await expect(ui.editor).toBeVisible({ timeout: 20_000 });
      for (const text of [words.first, words.second]) {
        const before = await ui.replies.count();
        await ui.send(text);
        await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
        await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
      }

      // « Revenir avant », its dialog, then its banner.
      const second = ui.userMessages.nth(1);
      await second.hover();
      // Its buttons, in words (aparté 1.11).
      await expect(second.getByRole('button', { name: words.back })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `message-actions-${locale}-${scheme}.png`) });
      await second.getByRole('button', { name: words.back }).click();
      await expect(page.locator('.rewind-dialog')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `rewind-dialog-${locale}-${scheme}.png`) });
      await page.locator('.rewind-dialog').getByRole('button', { name: words.confirm, exact: true }).click();
      await expect(page.locator('.rewind-banner')).toBeVisible();
      await page.screenshot({ path: join(into, `rewind-banner-${locale}-${scheme}.png`) });

      // « Brancher »: the branches of the conversation.
      // The header's: the first in the page (each message of the person has its own).
      await page.getByRole('button', { name: words.branch, exact: true }).first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `branches-${locale}-${scheme}.png`) });
      await page.keyboard.press('Escape');

      // Changing model: the composer's picker, then « Passer à … ? ».
      await page.getByRole('combobox', { name: words.picker }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `model-picker-${locale}-${scheme}.png`) });
      await page.getByRole('option', { name: /Qwen3-1\.7B/ }).click();
      await expect(page.locator('.model-switch-dialog dl')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `model-switch-${locale}-${scheme}.png`) });
      await page.locator('.model-switch-dialog').getByRole('button', { name: words.cancel }).click();

      // A setting that restarts the engine.
      await page.getByRole('button', { name: words.settings, exact: true }).click();
      const nav = page.getByRole('navigation', { name: words.settings });
      await nav.getByRole('link', { name: words.engine }).click();
      await page.getByRole('radiogroup', { name: words.cache }).locator('label', { hasText: 'q8_0' }).click();
      await expect(page.locator('.launch-restart')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `launch-restart-${locale}-${scheme}.png`) });
      await page.locator('.launch-restart').getByRole('button', { name: words.cancel }).click();

      // The engine unloaded: the card above the composer.
      await page.getByRole('button', { name: words.unload }).click();
      await page.waitForTimeout(1500);
      await nav.getByRole('link', { name: words.conversations }).click();
      await expect(page.locator('.engine-unloaded')).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: join(into, `engine-unloaded-${locale}-${scheme}.png`) });
    });
  }
}
