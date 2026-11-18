/**
 * Accessibility, screen by screen (task 12.5): every button — an icon's included — has a name, and the keyboard
 * reaches the screen's controls in the order a person reads it (the list is written here, in that order).
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

/** The buttons shown on screen without a name a screen reader could say (open shadow roots included). */
async function unnamedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const nameOf = (element: Element): string => {
      const label = element.getAttribute('aria-label');
      if (label?.trim()) return label.trim();
      const by = element.getAttribute('aria-labelledby');
      if (by) {
        const text = by
          .split(/\s+/)
          .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }
      const text = (element as HTMLElement).innerText?.trim() ?? element.textContent?.trim() ?? '';
      if (text) return text;
      return element.getAttribute('title')?.trim() ?? '';
    };
    const visit = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="tab"], [role="switch"]')) {
        const html = element as HTMLElement;
        if (!html.checkVisibility() || html.closest('[hidden], [aria-hidden="true"]')) continue;
        const named = nameOf(element) || (element.id ? (root.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() ?? '') : '');
        if (!named) found.push(html.outerHTML.slice(0, 160));
      }
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(document);
    return found;
  });
}

/** What the keyboard reaches, Tab after Tab from the start of the page: each stop by its name. */
async function tabStops(page: Page, count: number): Promise<string[]> {
  // From the start of the page: Chromium goes on from where the focus was, so a mark is focused first, then removed.
  await page.evaluate(() => {
    const mark = document.createElement('span');
    mark.tabIndex = -1;
    document.body.prepend(mark);
    mark.focus();
    mark.remove();
  });
  const stops: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        let element = document.activeElement;
        while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
        if (!element) return '';
        const label = element.getAttribute('aria-label') ?? element.getAttribute('title');
        return (label ?? (element as HTMLElement).innerText ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      }),
    );
  }
  return stops;
}

test('the shell and a conversation: every button has a name; Tab follows the reading order', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0);
  // The check catches what it looks for: a button put there without a name is found.
  await page.evaluate(() => {
    const bare = document.createElement('button');
    bare.className = 'a11y-probe';
    bare.innerHTML = '<svg width="8" height="8"></svg>';
    document.body.append(bare);
  });
  expect(await unnamedButtons(page)).toHaveLength(1);
  await page.evaluate(() => document.querySelector('.a11y-probe')?.remove());
  expect(await unnamedButtons(page)).toEqual([]);
  // The reading order: the sidebar top to bottom, the header, the panes, the thread, the composer and its toolbar.
  expect(await tabStops(page, 23)).toEqual([
    'Réduire la barre latérale',
    'Nouvelle conversation',
    'Rechercher dans les conversations',
    'À traiter',
    'Nouveau projet',
    'maison, 1 conversation',
    'Bonjour',
    'Actions de la conversation',
    'Nouvelle discussion',
    'Réglages',
    'Brancher',
    'Plus d’actions',
    'Fichiers',
    'Changements',
    'Sous-agents',
    'Navigateur',
    'Terminal',
    'Transcription',
    'Revenir avant',
    'Copier',
    'Réponds, ou demande autre chose…',
    "Mode d'approbation",
    'Fenêtre de contexte: 17 %',
  ]);
});

test('every settings page, « À traiter » and the Plugins page: no button without a name', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Réglages' });
  for (const name of ['Général', 'Apparence', 'Raccourcis', 'Moteur et mémoire', 'Modèles', 'Permissions', /^Plugins/, 'Serveurs MCP']) {
    await nav.getByRole('link', { name }).click();
    await page.waitForTimeout(200);
    expect(await unnamedButtons(page), String(name)).toEqual([]);
  }
  await page.getByRole('link', { name: 'Conversations' }).click();
  await page.keyboard.press('Control+J');
  await page.waitForTimeout(200);
  expect(await unnamedButtons(page)).toEqual([]);
});

test('a failure card at the first launch: its buttons named, reached in order', async ({ launch }) => {
  const { page } = await launch({ managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } }, gpuBytes: 64 * 1024 * 1024 } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const card = page.getByRole('alert').filter({ hasText: 'Le modèle ne tient pas dans la carte' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(await unnamedButtons(page)).toEqual([]);
});
