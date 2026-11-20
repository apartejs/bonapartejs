/**
 * The built-in browser (task 10.1): its manifest, read before anything of it runs, and its Node half. Its pages
 * are the app's — a native view a tab in the main process, never with Node nor the window's bridge — and its
 * pane is the app's. Its tools work on the agent's own tab in its conversation, never on one of the person's (the
 * browser redo, step 2).
 */

import { defineManifest } from '@aparte/bonaparte-plugin-sdk';

export { browser } from './node.js';

export const browserManifest = defineManifest({
  id: 'browser',
  name: { en: 'Browser', fr: 'Navigateur' },
  version: '1.0.0',
  description: { en: 'Pages the agent can read: console, DOM, screenshot.', fr: 'Des pages que l’agent peut lire : console, DOM, capture d’écran.' },
  effects: [
    { effect: 'network', what: { en: 'opens pages of the internet, and of this machine', fr: 'ouvre des pages d’Internet, et de cette machine' } },
    { effect: 'read', what: { en: 'reads and pictures the agent’s own page, in its conversation', fr: 'lit et capture la page de l’agent, dans sa conversation' } },
    { effect: 'execute', what: { en: 'clicks and types in the agent’s own page, in its conversation', fr: 'clique et tape dans la page de l’agent, dans sa conversation' } },
  ],
  contributes: {
    tools: [
      {
        name: 'browser_open',
        description:
          'Open an http(s) address in your own browser tab: a page of the internet, or of this machine (a dev server, localhost:5173), then read it with browser_read. ' +
          'Use it to see a page or an app run. Your tab is a session of its own, with none of the user’s logins or cookies, and an address of the private network is refused.',
        effect: 'network',
        inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The address, http or https.' } }, required: ['url'] },
      },
      {
        name: 'browser_open_file',
        description:
          'Open a file of the project in your own browser tab, to see a page you wrote run (index.html). ' +
          'Give its path as for read_file, then read it with browser_read. Only a file inside the project’s folders opens.',
        effect: 'read',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'The path of the file, in the project (bac/snake.html).' } },
          required: ['path'],
        },
      },
      {
        name: 'browser_read',
        description:
          'Read the page in your own browser tab: its title, its text, and what its console logged (errors first). ' +
          'Use it after browser_open or browser_act. It reads only your tab, never one of the user’s.',
        effect: 'read',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'browser_screenshot',
        description:
          'Take a picture of the page in your own browser tab, shown to the user. ' +
          'Use it when the user should see how the page looks. You cannot see the picture yourself: read the page with browser_read instead.',
        effect: 'read',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'browser_act',
        description:
          'Act on the page in your own browser tab: click an element, type text into a field, or scroll. ' +
          'Give a CSS selector for click and type, then read the page again to see the result. It works only on your tab, never on one of the user’s.',
        effect: 'execute',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['click', 'type', 'scroll'] },
            selector: { type: 'string', description: 'A CSS selector, for click and type.' },
            text: { type: 'string', description: 'What to type.' },
            by: { type: 'number', description: 'Pixels to scroll, down when positive.' },
          },
          required: ['action'],
        },
      },
    ],
  },
});
