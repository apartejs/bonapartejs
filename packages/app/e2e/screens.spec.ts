/**
 * Pictures of the screens, for whoever validates them: light and dark, French
 * and English. Not a test of anything. It runs only on request — set
 * `BONAPARTE_SCREENS` to the folder the pictures go to — and is skipped
 * otherwise.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_QWEN_TEMPLATE, tempRepo } from '@aparte/bonaparte-core/testing';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, FAKE_MCP_SERVER, test } from './fixtures/app.js';
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

/* ------------------------------------------------------------------------------------------------------------------
 * Phase 8: sub-agents at work, their pane, and a request of one (board « Une conversation avec des sous-agents au
 * travail »).
 * ---------------------------------------------------------------------------------------------------------------- */

const PHASE8 = {
  fr: { panes: 'Volets', pane: 'Sous-agents', waits: 'Attend le moteur', request: 'Demande d’accord', ask: 'Lance les tests.' },
  en: { panes: 'Panes', pane: 'Sub-agents', waits: 'Waiting for the engine', request: 'Approval request', ask: 'Run the tests.' },
};

const SUB_Q = '<|"|>';
const subCall = (name: string, args: Record<string, string>) =>
  `<|tool_call>call:${name}{${Object.entries(args)
    .map(([key, value]) => `${key}:${SUB_Q}${value}${SUB_Q}`)
    .join(',')}}<tool_call|>`;

/** Three leads in one step; each sub-agent reads a file, then returns a sentence; the conversation sums up. */
function threeLeads(locale: 'fr' | 'en') {
  const missions =
    locale === 'fr'
      ? [
          { name: 'Lecteur de logs', mission: 'comparer les 20 derniers runs de CI', tools: 'read' },
          { name: 'Explorateur', mission: 'ce qui a changé dans la CI et les tests depuis le 4/11', tools: 'read' },
          { name: 'Mesureur', mission: 'chronométrer les tests en local, fichier par fichier', tools: 'all' },
        ]
      : [
          { name: 'Log reader', mission: 'compare the last 20 CI runs', tools: 'read' },
          { name: 'Explorer', mission: 'what changed in CI and the tests since 11/4', tools: 'read' },
          { name: 'Timer', mission: 'time the tests locally, file by file', tools: 'all' },
        ];
  const result =
    locale === 'fr'
      ? 'Les 6 derniers runs passent de 6 à 14 min : l’étape « test » triple depuis le run 4802.'
      : 'The last 6 runs went from 6 to 14 min: the « test » step tripled from run 4802.';
  const summary =
    locale === 'fr'
      ? 'Les trois pistes concordent : depuis le 4/11, la suite d’intégration tourne sans cache.'
      : 'The three leads agree: since 11/4, the integration suite runs without its cache.';
  return (prompt: string): string => {
    const answered = prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
    if (prompt.includes('You are a sub-agent')) return answered ? result : subCall('read_file', { path: 'ci.yml' });
    return answered ? summary : missions.map((mission) => subCall('run_subagent', mission)).join('');
  };
}

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`sub-agents at work and their pane, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = PHASE8[locale];
      const { page, home } = await launch({ locale, engine: { responder: threeLeads(locale), paceMs: 90 } });
      await writeFile(join(home, 'ci.yml'), 'jobs:\n  test:\n    runs-on: ubuntu-latest\n');
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      await ui.send(locale === 'fr' ? 'La CI met 14 minutes depuis la semaine dernière, contre 6 avant. Trouve pourquoi.' : 'CI takes 14 minutes since last week, against 6 before. Find out why.');
      await expect(page.locator('.aparte-tool-activity', { hasText: words.waits }).first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole('group', { name: words.panes }).getByRole('button', { name: words.pane, exact: true }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `subagents-working-${locale}-${scheme}.png`) });
      await expect(ui.streamingReplies).toHaveCount(0, { timeout: 60_000 });
      await page.locator('.subagents-pane__row').nth(1).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(into, `subagents-pane-${locale}-${scheme}.png`) });
    });

    test(`a request of a sub-agent, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = PHASE8[locale];
      const name = locale === 'fr' ? 'Mesureur' : 'Timer';
      const responder = (prompt: string): string => {
        const answered = prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
        // The command's arguments are an array, as the tool takes them.
        const command = `<|tool_call>call:run_command{program:${SUB_Q}pnpm${SUB_Q},args:[${SUB_Q}test${SUB_Q},${SUB_Q}--reporter=verbose${SUB_Q}]}<tool_call|>`;
        if (prompt.includes('You are a sub-agent')) return answered ? '…' : command;
        return answered ? '…' : subCall('run_subagent', { name, mission: words.ask, tools: 'all' });
      };
      const { page } = await launch({ locale, engine: { responder } });
      await page.emulateMedia({ colorScheme: scheme });
      await chat(page).send(words.ask);
      await expect(page.getByRole('region', { name: words.request })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `subagent-approval-${locale}-${scheme}.png`) });
    });
  }
}

/* ------------------------------------------------------------------------------------------------------------------
 * Phase 8: « À traiter » (board « À traiter »): an approval, a question and a reply not read yet, in three
 * conversations; Ctrl J opens the page.
 * ---------------------------------------------------------------------------------------------------------------- */

const INBOX = {
  fr: {
    fresh: 'Nouvelle conversation',
    edit: 'Corrige l’affichage des dates dans src/format.ts',
    ask: 'Ajoute la validation zod au formulaire d’inscription',
    question: 'Une date vide : je la garde vide ou je la refuse ?',
    choices: ['La garder vide', 'La refuser'],
    night: 'Pourquoi la CI a-t-elle échoué cette nuit ?',
    marker: 'cette nuit',
    synthesis:
      'La CI a échoué cette nuit sur le test « export des factures » : le fuseau horaire du runner a changé, et deux dates passent au lendemain. Le correctif tient en une ligne.',
  },
  en: {
    fresh: 'New conversation',
    edit: 'Fix how dates are shown in src/format.ts',
    ask: 'Add zod validation to the sign-up form',
    question: 'An empty date: keep it empty or refuse it?',
    choices: ['Keep it empty', 'Refuse it'],
    night: 'Why did CI fail last night?',
    marker: 'last night',
    synthesis:
      'CI failed last night on the « invoice export » test: the runner’s time zone changed, and two dates moved to the next day. The fix is one line.',
  },
};

/**
 * An edit when the message names src/format.ts, a question with two choices when it says zod (answered from the
 * page since aparté 1.12), a synthesis for last night's CI.
 */
function inboxModel(locale: 'fr' | 'en') {
  const words = INBOX[locale];
  return (prompt: string): string => {
    const user = prompt.lastIndexOf('<|turn>user');
    if (prompt.lastIndexOf('<|tool_response>') > user) return locale === 'fr' ? 'Fait.' : 'Done.';
    const asked = prompt.slice(user);
    if (asked.includes('src/format.ts')) {
      return subCall('edit_file', { path: 'src/format.ts', old_string: 'return date.toString();', new_string: 'return date.toLocaleDateString();' });
    }
    if (asked.includes('zod')) {
      const options = words.choices.map((title) => `{title:${SUB_Q}${title}${SUB_Q}}`).join(',');
      return `<|tool_call>call:ask_user{question:${SUB_Q}${words.question}${SUB_Q},options:[${options}]}<tool_call|>`;
    }
    if (asked.includes(words.marker)) return words.synthesis;
    return 'ok';
  };
}

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`what waits for the person (À traiter), ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words = INBOX[locale];
      const { page, home } = await launch({ locale, engine: { responder: inboxModel(locale), paceMs: 40 } });
      await mkdir(join(home, 'src'), { recursive: true });
      await writeFile(join(home, 'src', 'format.ts'), 'export function label(date: Date): string {\n  return date.toString();\n}\n');
      await page.emulateMedia({ colorScheme: scheme });
      const ui = chat(page);
      const fresh = () => page.getByRole('button', { name: words.fresh }).first().click();

      await ui.send(words.edit);
      await expect(page.locator('.approval-card')).toBeVisible({ timeout: 20_000 });
      await fresh();
      await ui.send(words.ask);
      await expect(ui.question).toBeVisible({ timeout: 20_000 });
      await fresh();
      await ui.send(words.night);
      await fresh();
      await expect(page.locator('.conv-unread')).toBeVisible({ timeout: 30_000 });
      // The last click leaves its tooltip under the pointer: move it out of the way.
      await page.mouse.move(1, 1);

      await page.keyboard.press('Control+j');
      await expect(page.locator('.inbox-page .inbox-card')).toHaveCount(2, { timeout: 10_000 });
      await expect(page.locator('.inbox-page__unread')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `inbox-${locale}-${scheme}.png`) });
    });
  }
}

// Phase 9: the first launch (its recommended models, a service tested), and a discussion attached to a project.
for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the first launch and the discussion, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words =
        locale === 'fr'
          ? { service: /Un service existant/, test: 'Tester la connexion', newDiscussion: 'Nouvelle discussion', more: 'Plus d’actions', attach: 'Travailler dans un projet…' }
          : { service: /A service you already have/, test: 'Test the connection', newDiscussion: 'New discussion', more: 'More actions', attach: 'Work in a project…' };

      const first = await launch({
        locale,
        managed: { models: MODELS, gpuBytes: CARD },
        hub: { models: { 'gemma-4-e4b': { family: 'gemma' }, 'qwen3-8b': { family: 'qwen' } }, paceMs: 1500 },
        service: { models: ['qwen3:8b', 'gemma3:12b'], responder: () => ({ text: 'ok' }) },
        serviceAdded: false,
      });
      const page = first.page;
      await page.emulateMedia({ colorScheme: scheme });
      await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1400));
      await expect(page.locator('.recommended-row')).toHaveCount(2);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `first-run-${locale}-${scheme}.png`), animations: 'disabled' });
      await page.locator('.recommended-row').first().getByRole('button').click();
      await expect(page.locator('.recommended-row').first().getByRole('progressbar')).toBeVisible();
      await page.screenshot({ path: join(into, `first-run-downloading-${locale}-${scheme}.png`), animations: 'disabled' });

      await page.getByRole('radio', { name: words.service }).click();
      await page.getByRole('textbox', { name: locale === 'fr' ? 'Adresse' : 'Address' }).fill(`${first.service!.url}/v1`);
      await page.getByRole('button', { name: words.test }).click();
      await expect(page.locator('.first-run__tested--ok')).toBeVisible();
      await page.screenshot({ path: join(into, `first-run-service-${locale}-${scheme}.png`), animations: 'disabled' });
      await first.close();

      const second = await launch({ locale, engine: { responder: () => 'ok' } });
      await second.page.emulateMedia({ colorScheme: scheme });
      await second.page.getByRole('button', { name: words.newDiscussion }).first().click();
      await chat(second.page).send(locale === 'fr' ? 'Que dit la météo à Lille ?' : 'What is the weather in Lille?');
      await expect(chat(second.page).replies).toHaveCount(1, { timeout: 15_000 });
      await expect(chat(second.page).streamingReplies).toHaveCount(0, { timeout: 15_000 });
      await second.page.mouse.move(1, 1);
      await second.page.waitForTimeout(300);
      await second.page.screenshot({ path: join(into, `discussion-${locale}-${scheme}.png`), animations: 'disabled' });
      await second.page.getByRole('button', { name: words.more }).click();
      await second.page.getByRole('menuitem', { name: words.attach }).click();
      await expect(second.page.getByRole('dialog')).toBeVisible();
      await second.page.waitForTimeout(300);
      await second.page.screenshot({ path: join(into, `attach-project-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

// Phase 10: the built-in browser and the person's tools on a page, the new tab, the MCP servers.
const RECAP = [
  '<!doctype html><html><head><title>Récap hebdo</title><style>',
  'body { font: 15px system-ui, sans-serif; margin: 32px; color: #1F2A3C; }',
  'table { border-collapse: collapse; width: 100%; max-width: 560px; }',
  'td, th { padding: 10px; border-bottom: 1px solid #EEF0F4; text-align: left; }',
  'button { margin-top: 16px; padding: 8px 14px; border: 0; border-radius: 8px; background: #1F2A3C; color: white; }',
  '</style></head><body><h1>Récap de la semaine</h1>',
  '<table><thead><tr><th>Jour</th><th>Heures</th><th>Décimal</th></tr></thead><tbody>',
  '<tr><td>Lundi</td><td>1 h 30</td><td class="hours" style="font-weight: 700">1,3 h</td></tr>',
  '<tr><td>Mardi</td><td>2 h 15</td><td>2,15 h</td></tr><tr><td>Total</td><td>7 h 15</td><td>6,75 h</td></tr>',
  '</tbody></table><button class="export">Exporter</button>',
  `<script>console.error("TypeError: Cannot read properties of undefined (reading 'minutes')"); console.warn("Image sans attribut alt : logo.svg")</script>`,
  '</body></html>',
].join('');

/** The page of the browser is a native view, absent from a picture of the window: its own picture is laid where it sits. */
async function layBrowserPage(app: ElectronApplication, page: Page): Promise<void> {
  const shot = await app.evaluate(async () => {
    const browser = (
      globalThis as unknown as {
        __bonaparteBrowser: {
          placement(): { bounds: { x: number; y: number; width: number; height: number } } | null;
          agentScreenshot(): Promise<{ png: Uint8Array } | null>;
        };
      }
    ).__bonaparteBrowser;
    const placed = browser.placement();
    const picture = await browser.agentScreenshot();
    return placed && picture ? { bounds: placed.bounds, png: Buffer.from(picture.png).toString('base64') } : null;
  });
  await page.evaluate((laid) => {
    document.getElementById('bonaparte-screens-page')?.remove();
    if (!laid) return;
    const picture = document.createElement('img');
    picture.id = 'bonaparte-screens-page';
    picture.src = `data:image/png;base64,${laid.png}`;
    Object.assign(picture.style, {
      position: 'fixed',
      left: `${laid.bounds.x}px`,
      top: `${laid.bounds.y}px`,
      width: `${laid.bounds.width}px`,
      height: `${laid.bounds.height}px`,
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(picture);
  }, shot);
  await page.waitForTimeout(300);
}

const clickInPage = (app: ElectronApplication, selector: string) =>
  app.evaluate(
    (_electron, target) =>
      (globalThis as unknown as { __bonaparteBrowser: { agentAct(action: { kind: 'click'; selector: string }): Promise<unknown> } }).__bonaparteBrowser.agentAct({
        kind: 'click',
        selector: target,
      }),
    selector,
  );

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the browser and its tools, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words =
        locale === 'fr'
          ? {
              group: 'Volets',
              browser: 'Navigateur',
              address: 'Adresse',
              tools: 'Outils de la page',
              select: 'Sélectionner un élément',
              commentThis: 'Commenter',
              field: 'Commentaire',
              console: 'Console',
              settings: 'Réglages',
              mcp: 'Serveurs MCP',
              start: 'Démarrer',
              expand: 'Déplier fake',
              first: 'Ça devrait afficher 1,5 h.',
              second: 'Sur téléphone, le bouton déborde de l’écran.',
            }
          : {
              group: 'Panes',
              browser: 'Browser',
              address: 'Address',
              tools: 'Page tools',
              select: 'Select an element',
              commentThis: 'Comment',
              field: 'Comment',
              console: 'Console',
              settings: 'Settings',
              mcp: 'MCP servers',
              start: 'Start',
              expand: 'Expand fake',
              first: 'This should show 1.5 h.',
              second: 'On a phone, the button runs off the screen.',
            };
      const { app, page, pages, home } = await launch({
        locale,
        engine: { responder: () => 'ok' },
        pages: { '/rapport': RECAP },
        mcp: { fake: { command: process.execPath, args: [FAKE_MCP_SERVER] } },
      });
      await writeFile(join(home, 'package.json'), JSON.stringify({ name: 'spanwise', scripts: { dev: 'vite', storybook: 'storybook dev', test: 'vitest' } }));
      await page.emulateMedia({ colorScheme: scheme });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await expect(chat(page).editor).toBeVisible();
      await page.getByRole('group', { name: words.group }).getByRole('button', { name: words.browser }).click();
      // The new tab first: what the project runs.
      await expect(page.locator('[data-run="dev"]')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `browser-new-tab-${locale}-${scheme}.png`), animations: 'disabled' });

      const address = page.getByRole('textbox', { name: words.address });
      await address.fill(`${pages!.url}/rapport`);
      await address.press('Enter');
      await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('group', { name: words.tools }).getByRole('button', { name: words.select }).click();
      const card = page.getByRole('region', { name: 'td.hours' });
      await expect(async () => {
        await clickInPage(app, 'td.hours');
        await expect(card).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await page.mouse.move(1, 1);
      await layBrowserPage(app, page);
      await page.screenshot({ path: join(into, `browser-select-${locale}-${scheme}.png`), animations: 'disabled' });

      await card.getByRole('button', { name: words.commentThis, exact: true }).click();
      await page.getByRole('textbox', { name: `${words.field} 1` }).fill(words.first);
      await expect(async () => {
        await clickInPage(app, 'button.export');
        await expect(page.getByRole('textbox', { name: `${words.field} 2` })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await page.getByRole('textbox', { name: `${words.field} 2` }).fill(words.second);
      await page.getByRole('region', { name: words.console }).getByRole('button', { name: new RegExp(words.console) }).click();
      await page.waitForTimeout(500);
      await layBrowserPage(app, page);
      await page.screenshot({ path: join(into, `browser-comment-console-${locale}-${scheme}.png`), animations: 'disabled' });

      await page.getByRole('button', { name: words.settings, exact: true }).click();
      await page.getByRole('navigation', { name: words.settings }).getByRole('link', { name: words.mcp }).click();
      const fake = page.getByRole('list', { name: words.mcp }).getByRole('listitem').filter({ hasText: 'fake' });
      await fake.getByRole('button', { name: words.start }).click();
      await expect(fake).toContainText(/\d+ (outils|tools)/, { timeout: 15_000 });
      await fake.getByRole('button', { name: words.expand }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(into, `mcp-servers-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

const BONJOUR_PLUGIN: Record<string, string> = {
  'plugin.json': JSON.stringify({
    id: 'bonjour',
    name: 'Bonjour',
    version: '0.1.0',
    description: { en: 'Says hello in the language of the conversation.', fr: 'Dit bonjour dans la langue de la conversation.' },
    entry: { node: 'index.mjs' },
    effects: [{ effect: 'read', what: { en: 'the conversation’s language', fr: 'la langue de la conversation' } }],
    contributes: { tools: [{ name: 'greet', description: 'Say hello.', effect: 'read' }] },
  }),
  'index.mjs': "export default { activate(ctx) { ctx.registerToolHandler('greet', async () => ({ content: 'bonjour' })); } };\n",
};

const GEMMA_QUOTE = '<|"|>';
const gemmaValue = (value: unknown): string => {
  if (typeof value === 'string') return `${GEMMA_QUOTE}${value}${GEMMA_QUOTE}`;
  if (Array.isArray(value)) return `[${value.map(gemmaValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, inner]) => `${key}:${gemmaValue(inner)}`).join(',')}}`;
  return String(value);
};
const CHANGELOG = {
  id: 'changelog',
  name: 'changelog',
  version: '0.1.0',
  effects: [{ effect: 'execute', what: { en: 'run git log in the project', fr: 'lancer git log dans le projet' } }],
  contributes: { commands: [{ name: 'changelog', description: { en: 'Sum up the commits of the day', fr: 'Résumer les commits du jour' } }] },
};
const CHANGELOG_CODE = "export default { activate(ctx) { ctx.registerCommand('changelog', () => ({ send: 'Sum up the commits of the day.' })); } };";
const makesPlugin = (prompt: string): string => {
  const user = prompt.lastIndexOf('<|turn>user');
  const results = prompt.slice(user).split('<|tool_response>').length - 1;
  if (!prompt.slice(user).includes('plugin')) return 'ok';
  if (results === 0) return '<|tool_call>call:harness_inspect{}<tool_call|>';
  if (results === 1) return `<|tool_call>call:extension_define{manifest:${gemmaValue(CHANGELOG)},code:${gemmaValue(CHANGELOG_CODE)}}<tool_call|>`;
  return prompt.includes('Crée-moi') ? 'Voilà le plugin. Rien ne tourne tant que tu n’as pas dit oui.' : 'Here is the plugin. Nothing runs until you say yes.';
};

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the plugins, added and made in a conversation, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const words =
        locale === 'fr'
          ? { settings: 'Réglages', try: 'Essayer dans cette conversation', add: 'Ajouter…', dialog: 'Ajouter un plugin', field: 'Dossier du plugin', read: 'Lire le plugin', ask: 'Crée-moi un plugin : une commande /changelog qui résume les commits du jour.' }
          : { settings: 'Settings', try: 'Try it in this conversation', add: 'Add…', dialog: 'Add a plugin', field: 'Plugin folder', read: 'Read the plugin', ask: 'Make me a plugin: a /changelog command that sums up the commits of the day.' };
      const source = await mkdtemp(join(tmpdir(), 'bp-screens-plugin-'));
      for (const [name, text] of Object.entries(BONJOUR_PLUGIN)) await writeFile(join(source, name), text);
      const { app, page } = await launch({ locale, engine: { responder: makesPlugin }, settings: { defaultMode: 'plume' }, plugins: { bonjour: BONJOUR_PLUGIN } });
      await page.emulateMedia({ colorScheme: scheme });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      const ui = chat(page);
      await expect(ui.editor).toBeVisible();

      // The card of a plugin made in the conversation, its code shown.
      await ui.send(words.ask);
      await expect(page.locator('section.extension-card[data-extension="changelog"]')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(into, `plugin-made-${locale}-${scheme}.png`), animations: 'disabled' });
      // Tried here: the Plugins page lists it among those made in a conversation.
      await page.locator('section.extension-card[data-extension="changelog"]').getByRole('button', { name: words.try }).click();
      await expect(page.locator('section.extension-card .extension-card__status')).not.toBeEmpty({ timeout: 15_000 });

      // Réglages · Plugins.
      await page.getByRole('button', { name: words.settings, exact: true }).click();
      await page.getByRole('navigation', { name: words.settings }).getByRole('link', { name: /^Plugins/ }).click();
      await expect(page.locator('.plugin-row__name', { hasText: 'Bonjour' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `plugins-${locale}-${scheme}.png`), animations: 'disabled', fullPage: true });

      // « Ajouter un plugin », its preview read.
      await page.getByRole('button', { name: words.add }).click();
      const dialog = page.getByRole('dialog', { name: words.dialog });
      await dialog.getByRole('textbox', { name: words.field }).fill(source);
      await dialog.getByRole('button', { name: words.read }).click();
      await expect(dialog.getByText(/greet/)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(into, `plugin-add-${locale}-${scheme}.png`), animations: 'disabled' });
    });
  }
}

const shot = (page: Page, into: string, name: string) => page.screenshot({ path: join(into, name), animations: 'disabled' });

for (const locale of ['fr', 'en'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the finishing of phase 12: shortcuts, the mascot, the failures, a conversation's settings, the monitor, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const fr = locale === 'fr';
      const words = fr
        ? { settings: 'Réglages', shortcuts: 'Raccourcis', mode: /^Changer de mode/, more: 'Plus d’actions', convSettings: 'Réglages de la conversation…', start: 'Démarrer', composer: 'Réponds, ou demande autre chose…', ask: 'Raconte' }
        : { settings: 'Settings', shortcuts: 'Shortcuts', mode: /^Change mode/, more: 'More actions', convSettings: 'Conversation settings…', start: 'Start', composer: 'Reply, or ask something else…', ask: 'Tell me' };

      // A conversation at work, the engine's card with its readings, the mascot writing; then at 820 px.
      const { app, page } = await launch({
        locale,
        managed: { models: { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } } },
        env: {
          FAKE_LLAMA_ANSWER: Array.from({ length: 80 }, (_, index) => `mot${index}`).join(' '),
          FAKE_LLAMA_PACE_MS: '60',
          BONAPARTE_E2E_RESOURCES: JSON.stringify({ cpu: 34, usedBytes: 21 * 1024 ** 3, totalBytes: 64 * 1024 ** 3, gpuUtilization: 61 }),
        },
      });
      await page.emulateMedia({ colorScheme: scheme });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await page.getByRole('button', { name: words.start }).click();
      const ui = chat(page);
      await expect(ui.composer(words.composer)).toBeVisible({ timeout: 20_000 });
      await ui.send(words.ask);
      await expect(page.locator('.bonaparte-sidebar .mascot')).toHaveAttribute('data-state', 'talking', { timeout: 15_000 });
      await expect(page.locator('.engine-card__resources')).toBeVisible({ timeout: 10_000 });
      await shot(page, into, `at-work-${locale}-${scheme}.png`);
      await expect(ui.streamingReplies).toHaveCount(0, { timeout: 30_000 });

      await page.getByRole('button', { name: words.more }).click();
      await page.getByRole('menuitem', { name: words.convSettings }).click();
      await page.waitForTimeout(300);
      await shot(page, into, `conversation-settings-${locale}-${scheme}.png`);
      await page.keyboard.press('Escape');

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 1000));
      await page.waitForTimeout(400);
      await shot(page, into, `narrow-conversation-${locale}-${scheme}.png`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await page.waitForTimeout(300);

      // Réglages · Raccourcis, a row waiting for its keys.
      await page.getByRole('button', { name: words.settings, exact: true }).click();
      await page.getByRole('navigation', { name: words.settings }).getByRole('link', { name: words.shortcuts }).click();
      await page.getByRole('button', { name: words.mode }).click();
      await page.waitForTimeout(200);
      await shot(page, into, `shortcuts-${locale}-${scheme}.png`);
      await page.keyboard.press('Escape');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 1000));
      await page.waitForTimeout(400);
      await shot(page, into, `narrow-shortcuts-${locale}-${scheme}.png`);
    });

    test(`the failures of phase 12, ${locale}, ${scheme}`, async ({ launch }) => {
      test.skip(!folder, 'pictures are taken on request: set BONAPARTE_SCREENS to a folder');
      const into = folder as string;
      await mkdir(into, { recursive: true });
      const fr = locale === 'fr';
      const start = fr ? 'Démarrer' : 'Start';

      // A model too big for the card.
      const big = await launch({ locale, managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } }, gpuBytes: 64 * 1024 * 1024 } });
      await big.page.emulateMedia({ colorScheme: scheme });
      await big.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await big.page.getByRole('button', { name: start }).click();
      await expect(big.page.locator('.failure-card')).toBeVisible({ timeout: 15_000 });
      await big.page.locator('.failure-card').scrollIntoViewIfNeeded();
      await shot(big.page, into, `failure-too-big-${locale}-${scheme}.png`);
      await big.close();

      // llama.cpp missing.
      const missing = await launch({ locale, managed: { models: { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } }, releases: true, llama: 'missing' } });
      await missing.page.emulateMedia({ colorScheme: scheme });
      await missing.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await expect(missing.page.locator('.failure-card')).toBeVisible({ timeout: 15_000 });
      await shot(missing.page, into, `failure-llama-missing-${locale}-${scheme}.png`);
      await missing.close();

      // The engine stops during a reply.
      const died = await launch({ locale, engine: { responder: () => 'un deux trois quatre cinq', failAfter: 2 } });
      await died.page.emulateMedia({ colorScheme: scheme });
      await died.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await chat(died.page).send(fr ? 'Compte' : 'Count');
      await expect(died.page.locator('.failure-card')).toBeVisible({ timeout: 15_000 });
      await shot(died.page, into, `failure-engine-died-${locale}-${scheme}.png`);
      await died.close();

      // The disk nearly full.
      const disk = await launch({ locale, managed: { models: { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } } }, env: { BONAPARTE_E2E_FREE_BYTES: String(300 * 1024 * 1024) } });
      await disk.page.emulateMedia({ colorScheme: scheme });
      await disk.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
      await disk.page.getByRole('button', { name: start }).click();
      await expect(chat(disk.page).composer(fr ? 'Réponds, ou demande autre chose…' : 'Reply, or ask something else…')).toBeVisible({ timeout: 20_000 });
      await chat(disk.page).send(fr ? 'Bonjour' : 'Hello');
      await expect(disk.page.locator('.failure-card')).toBeVisible({ timeout: 15_000 });
      await shot(disk.page, into, `failure-disk-full-${locale}-${scheme}.png`);
      await disk.close();
    });
  }
}
