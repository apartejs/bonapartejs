/**
 * Screenshots of every screen, for review — not a test of behaviour. Runs
 * only when BONAPARTE_SCREENS names the output folder:
 *
 *   BONAPARTE_SCREENS=<dir> pnpm exec playwright test e2e/screens.spec.ts
 *
 * One launch per language, both themes, then a narrow window: the thread
 * with its history, an approval with its diff, the turn that follows, the
 * hub's sections, the dialogs, the terminal. The data is seeded to look
 * like real use — a project, pinned and archived conversations, a branch,
 * grants, MCP servers (one working, one failing, one unreadable entry).
 */

import { ConversationStore, GrantStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EN } from '../src/renderer/src/i18n/en.js';
import { FR } from '../src/renderer/src/i18n/fr.js';
import type { AppTranslations } from '../src/renderer/src/i18n/types.js';

const OUT = process.env['BONAPARTE_SCREENS'];
test.skip(!OUT, 'screenshots on demand only (BONAPARTE_SCREENS=<dir>)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

const FAKE_MCP = join(import.meta.dirname, '..', '..', 'core', 'src', 'testing', 'fake-mcp-server.mjs');
const EDIT_CALL =
  '<tool_call>{"name": "edit_file", "arguments": {"path": "notes.md", "old_string": "# Notes", "new_string": "# Session store — open questions"}}</tool_call>';

const COPY = {
  en: {
    main: 'Refactor the session store',
    pinned: 'Release checklist',
    archived: 'Old tokenizer experiment',
    loose: 'Quick question about regexes',
    ask: 'Why does the session store reopen on every message?',
    thinking: 'The store is closed by the engine after each turn; let me read where that happens before answering.',
    answer:
      'It reopens because `close()` runs after every turn in `conversation-engine.ts`:\n\n' +
      '1. the turn ends and `saveState()` writes the slot to disk;\n' +
      '2. the next `send()` finds no session and calls `open()` again.\n\n' +
      '```ts\nif (this.activeId !== conversationId || !this.session) {\n  const outcome = await this.open(conversationId);\n}\n```\n\n' +
      'Keeping the session open between turns would save the restore — about **26 ms** here.',
    edit: 'Rename the heading of notes.md to say what the file is about.',
    done: 'Done — the heading of `notes.md` now names the open questions of the session store.',
  },
  fr: {
    main: 'Refondre le store de sessions',
    pinned: 'Check-list de publication',
    archived: 'Vieil essai de tokenizer',
    loose: 'Petite question sur les regex',
    ask: 'Pourquoi le store de sessions se rouvre-t-il à chaque message ?',
    thinking: 'Le moteur ferme le store après chaque tour ; je lis où avant de répondre.',
    answer:
      'Il se rouvre parce que `close()` passe après chaque tour dans `conversation-engine.ts` :\n\n' +
      '1. le tour finit et `saveState()` écrit le slot sur le disque ;\n' +
      '2. le `send()` suivant ne trouve plus de session et rappelle `open()`.\n\n' +
      '```ts\nif (this.activeId !== conversationId || !this.session) {\n  const outcome = await this.open(conversationId);\n}\n```\n\n' +
      'Garder la session ouverte entre deux tours épargnerait la restauration — environ **26 ms** ici.',
    edit: 'Renomme le titre de notes.md pour dire de quoi parle le fichier.',
    done: 'Fait — le titre de `notes.md` nomme maintenant les questions ouvertes du store de sessions.',
  },
} as const;

type Locale = keyof typeof COPY;

async function launch(locale: Locale): Promise<{ app: ElectronApplication; server: FakeLlamaServer }> {
  const copy = COPY[locale];
  const server = await startFakeLlamaServer({
    paceMs: 3,
    responder: (prompt) => {
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      if (lastUser.includes('[tool result:')) return copy.done;
      if (lastUser.includes('notes.md')) return EDIT_CALL;
      return 'OK.';
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), `bonaparte-screens-${locale}-`));
  const repo = join(dataDir, 'session-store');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'notes.md'), '# Notes\n\n- reopen on every message?\n- keep the slot warm?\n', 'utf8');
  await writeFile(join(repo, 'AGENTS.md'), '# Conventions\n\nTests first. English in the code.\n', 'utf8');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'session-store', scripts: { dev: 'vite', test: 'vitest' } }), 'utf8');
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      currentConversationId: 'conv-main',
      locale,
      mode: 'repetition',
      // A GPU asked for but not running: the launch section shows its notice.
      settings: { thinking: true, gpuAcceleration: 'on' },
    }),
  );
  await writeFile(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'demo', name: 'session-store', roots: [repo], createdAt: 'x', updatedAt: 'x' }],
    }),
  );
  await writeFile(
    join(dataDir, 'config', 'mcp-servers.json'),
    JSON.stringify({
      mcpServers: {
        fake: { command: process.execPath, args: [FAKE_MCP] },
        broken: { command: process.execPath, args: [FAKE_MCP], env: { FAKE_MCP_FAIL_START: '1' } },
        'bad name!': { command: 'node' },
      },
    }),
  );
  const grants = new GrantStore(join(dataDir, 'config'));
  await grants.load();
  await grants.add('demo', { tool: 'run_shell', commandPrefix: 'pnpm' });
  await grants.add('demo', { tool: 'mcp__fake__echo' });
  await grants.add(undefined, { tool: 'run_shell', exactCommand: 'git status' });

  const store = new ConversationStore(join(dataDir, 'conversations'));
  const at = new Date().toISOString();
  await store.create('conv-main', { title: copy.main, projectId: 'demo' });
  await store.appendEvent('conv-main', {
    type: 'user',
    text: copy.ask,
    attachments: [{ name: 'engine.log', content: 'open conv-main\nclose conv-main\nopen conv-main\n' }],
    at,
  });
  await store.appendEvent('conv-main', {
    type: 'assistant',
    entry: {
      role: 'assistant',
      text: '',
      thinking: copy.thinking,
      reasoning: true,
      calls: [{ name: 'read_file', arguments: { path: 'src/conversation-engine.ts' } }],
    },
    at,
  });
  await store.appendEvent('conv-main', {
    type: 'tool_results',
    entry: { role: 'tool_results', results: [{ name: 'read_file', ok: true, content: 'export class ConversationEngine { … }' }] },
    at,
  });
  await store.appendEvent('conv-main', {
    type: 'assistant',
    entry: { role: 'assistant', text: copy.answer, reasoning: true },
    at,
  });
  await store.create('conv-pinned', { title: copy.pinned, projectId: 'demo' });
  await store.setMarks('conv-pinned', { pinned: true });
  await store.create('conv-archived', { title: copy.archived, projectId: 'demo' });
  await store.setMarks('conv-archived', { archived: true });
  await store.branch('conv-main', 'conv-branch', { title: `${copy.main} (branch)`, keepEvents: 1 });
  await store.create('conv-loose', { title: copy.loose });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  const app = await electron.launch({ args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')], env });
  return { app, server };
}

async function shot(window: Page, name: string): Promise<void> {
  // Animations settle (menus, dialogs), the caret stops mattering.
  await window.waitForTimeout(350);
  await window.screenshot({ path: join(OUT as string, `${name}.png`) });
}

async function setTheme(window: Page, theme: 'light' | 'dark'): Promise<void> {
  await window.evaluate((value) => localStorage.setItem('bp.theme', value), theme);
  await window.reload();
  await window.locator('.app-shell').waitFor();
  // A capture shows end states: transitions and animations would be caught
  // half-way (a highlight still on the previous item, a button mid-fade).
  await window.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }',
  });
}

/**
 * A hidden window paints no frames: smooth scrolls and anything waiting on
 * one never finish. Shown off-screen, without focus, it paints like a real
 * one and stays out of the way.
 */
async function paintOffScreen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setSkipTaskbar(true);
    win.setPosition(-4000, 0);
    win.showInactive();
  });
}

async function tour(app: ElectronApplication, locale: Locale, t: AppTranslations): Promise<void> {
  const copy = COPY[locale];
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await paintOffScreen(app);

  for (const theme of ['light', 'dark'] as const) {
    const tag = `${locale}-${theme}`;
    await setTheme(window, theme);
    const thread = window.locator('.chat-wrap');
    await expect(thread).toContainText(copy.ask.slice(0, 20));
    await shot(window, `${tag}-01-chat-history`);

    await window.locator('.conv-row').first().hover();
    await window.getByRole('button', { name: t.conversations.rowMenu }).first().click();
    await shot(window, `${tag}-02-sidebar-menu`);
    await window.keyboard.press('Escape');

    await window.locator('.conv-chip').first().click();
    await shot(window, `${tag}-03-project-popover`);
    await window.keyboard.press('Escape');

    // A turn that asks before writing: the approval, with its diff.
    const editor = window.locator('.aparte-ci-editor');
    await editor.fill(copy.edit);
    await editor.press('Enter');
    const allow = window.getByRole('button', { name: t.approval.allow, exact: true });
    await allow.waitFor({ timeout: 15_000 });
    await shot(window, `${tag}-04-approval-diff`);
    await allow.click();
    await expect(thread).toContainText(copy.done.slice(0, 12), { timeout: 15_000 });
    await shot(window, `${tag}-05-after-turn`);

    await window.getByRole('button', { name: t.header.actions, exact: true }).click();
    await shot(window, `${tag}-06-header-menu`);
    await window.getByRole('menuitem', { name: t.header.compact }).click();
    await shot(window, `${tag}-07-compact-dialog`);
    await window.keyboard.press('Escape');

    await window.getByRole('button', { name: 'Settings' === t.settings.heading ? 'Settings' : t.settings.heading }).last().click();
    const hub = window.locator('.settings-hub');
    await hub.waitFor();
    const sections = hub.locator('.settings-nav-item');
    const count = await sections.count();
    for (let index = 0; index < count; index++) {
      await sections.nth(index).click();
      if ((await sections.nth(index).textContent())?.includes('MCP')) {
        await expect(hub.locator('.mcp-row[data-state="connected"]')).toHaveCount(1, { timeout: 20_000 });
      }
      await shot(window, `${tag}-1${index}-hub-${index}`);
    }
    await hub.getByRole('button', { name: t.settings.close }).click();

    await window.locator('.tooling-home-view').nth(2).click();
    await window.locator('.xterm').first().waitFor({ timeout: 15_000 });
    await shot(window, `${tag}-20-terminal`);
    await window.locator('.tooling-tab-close').first().click().catch(() => undefined);
  }

  // Narrow: the flanks become drawers.
  await setTheme(window, 'light');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 820));
  await window.waitForTimeout(500);
  await shot(window, `${locale}-narrow-01-chat`);
  await window.getByRole('button', { name: t.settings.heading }).last().click();
  await window.locator('.settings-nav-item').first().waitFor();
  await shot(window, `${locale}-narrow-02-hub`);
}

for (const locale of ['en', 'fr'] as const) {
  test(`screens — ${locale}`, async () => {
    await mkdir(OUT as string, { recursive: true });
    const { app, server } = await launch(locale);
    try {
      await tour(app, locale, locale === 'en' ? EN : FR);
    } finally {
      await app.close();
      await server.close();
    }
  });
}
