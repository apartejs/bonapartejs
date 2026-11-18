/**
 * The view of a plugin of a third party, end to end (task 11.2): its pane opens from its icon, named as its
 * manifest says; its view is a sandboxed frame on `bonaparte-plugin://<id>/` — no bridge, no reach of the app's
 * pages, the window's own objects out of reach — and it asks its plugin through the window, which answers it; it
 * follows the app's theme. The view here speaks the messages by hand, as the SDK does (`connectView`).
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const VIEW_JS = `
const say = (id, text) => (document.getElementById(id).textContent = text);
const attempt = async (run) => { try { await run(); return 'reached'; } catch { return 'blocked'; } };
const bridge = typeof window.bonaparte;
const parentObjects = await attempt(() => window.parent.document.title);
const app = await attempt(() => fetch('bonaparte://app/'));
say('reach', 'bridge ' + bridge + '; parent ' + parentObjects + '; app ' + app);
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.channel !== 'bonaparte-view') return;
  if (message.type === 'reply') say('count', message.ok ? 'count ' + message.value : 'refused ' + message.error);
  if (message.type === 'theme') say('theme', message.theme);
});
window.parent.postMessage({ channel: 'bonaparte-view', type: 'ready' }, '*');
window.parent.postMessage({ channel: 'bonaparte-view', type: 'invoke', id: 1, command: 'count' }, '*');
`;

const PLUGIN: Record<string, string> = {
  'plugin.json': JSON.stringify({
    id: 'notes',
    name: 'Notes',
    version: '0.1.0',
    entry: { node: 'index.mjs', view: 'view.html' },
    effects: [{ effect: 'read', what: 'nothing' }],
    contributes: { panes: [{ id: 'list', title: { en: 'Notes', fr: 'Les notes' } }] },
  }),
  'index.mjs': "export default { activate(ctx) { ctx.registerCommand('count', () => 3); } };\n",
  'view.html':
    '<!doctype html><html><head><meta charset="utf-8"><title>Notes</title><link rel="stylesheet" href="/@bonaparte/kit.css"><script type="module" src="view.js"></script></head>' +
    '<body><p id="reach"></p><p id="count"></p><p id="theme"></p></body></html>',
  'view.js': VIEW_JS,
};

test('a plugin’s view: its pane from its icon, a sandboxed frame that reaches nothing of the app but its plugin, in the app’s theme', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, plugins: { notes: PLUGIN } });
  await expect(chat(page).editor).toBeVisible();
  const toggle = page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Les notes' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const frame = page.frameLocator('iframe[title="Les notes"]');
  await expect(frame.locator('#count')).toHaveText('count 3', { timeout: 15_000 });
  await expect(frame.locator('#reach')).toHaveText('bridge undefined; parent blocked; app blocked');
  await expect(frame.locator('#theme')).toHaveText(/^(light|dark)$/);
  const before = await frame.locator('#theme').textContent();
  await page.evaluate((theme) => (document.documentElement.dataset['aparteTheme'] = theme), before === 'dark' ? 'light' : 'dark');
  await expect(frame.locator('#theme')).toHaveText(before === 'dark' ? 'light' : 'dark');
  await expect(page.locator('iframe[title="Les notes"]')).toHaveAttribute('sandbox', 'allow-scripts');
});
