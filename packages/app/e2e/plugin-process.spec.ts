/**
 * A plugin of a third party, end to end (task 11.1): added under `<data>/plugins/<id>/`, it is started at launch
 * in an Electron utility process of its own; its tool reaches the model under its name and answers from that
 * process — another process than the app's, without the app's secrets in its environment.
 *
 * Found here: Electron 45's utility process does not honour Node's permission model (`--permission` leaves
 * `process.permission` undefined). The plugin's process is an ordinary Node process, which the dialog says.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const PLUGIN: Record<string, string> = {
  'plugin.json': JSON.stringify({
    id: 'bonjour',
    name: 'Bonjour',
    version: '0.1.0',
    entry: { node: 'index.mjs' },
    effects: [{ effect: 'read', what: 'nothing' }],
    contributes: { tools: [{ name: 'greet', description: 'Say hello, and which process says it.', effect: 'read' }] },
  }),
  'index.mjs': [
    'export default { activate(ctx) {',
    "  ctx.registerToolHandler('greet', async () => ({ content: `bonjour from ${process.pid}; secret ${process.env.BONAPARTE_TEST_TOKEN ?? 'absent'}` }));",
    '} };',
    '',
  ].join('\n'),
};

test('a plugin added runs in its own process: its tool answers the model from there, without the app’s secrets', async ({ launch }) => {
  const prompts: string[] = [];
  const responder = (prompt: string): string => {
    prompts.push(prompt);
    const user = prompt.lastIndexOf('<|turn>user');
    return prompt.slice(user).includes('<|tool_response>') ? 'Fini.' : '<|tool_call>call:plugin__bonjour__greet{}<tool_call|>';
  };
  const { app, page } = await launch({ engine: { responder }, plugins: { bonjour: PLUGIN }, env: { BONAPARTE_TEST_TOKEN: 'sesame' } });
  await chat(page).send('Salue-moi');
  await expect(chat(page).replyText).toHaveText('Fini.', { timeout: 30_000 });
  const answered = prompts.findLast((prompt) => prompt.includes('bonjour from')) ?? '';
  const pid = Number(/bonjour from (\d+)/.exec(answered)?.[1]);
  expect(pid).toBeGreaterThan(0);
  expect(pid).not.toBe(await app.evaluate(() => process.pid));
  expect(answered).toContain('secret absent');
});
