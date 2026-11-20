/**
 * The built-in browser (task 10.1): its manifest, read before anything of it runs, and its Node half. Its pages
 * are the app's — a native view a tab in the main process, never with Node nor the window's bridge — and its
 * pane is the app's. Its tools work on the tab the person sees.
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
    { effect: 'read', what: { en: 'reads and pictures the page shown', fr: 'lit et capture la page affichée' } },
    { effect: 'execute', what: { en: 'clicks and types in the page shown', fr: 'clique et tape dans la page affichée' } },
  ],
  contributes: {
    tools: [
      {
        name: 'browser_open',
        description:
          'Open an address in the built-in browser, in the tab the person sees: a page of the internet, or of this machine (a dev server, localhost:5173). Then read it with browser_read.',
        effect: 'network',
        inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The address, http or https.' } }, required: ['url'] },
      },
      {
        name: 'browser_open_file',
        description:
          'Open a file of the project in the built-in browser, in the tab the person sees: a page you wrote (index.html), to see it run. Give its path, as for read_file. Then read it with browser_read.',
        effect: 'read',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'The path of the file, in the project (bac/snake.html).' } },
          required: ['path'],
        },
      },
      {
        name: 'browser_read',
        description: 'Read the page shown in the built-in browser: its title, its text, and what its console logged (errors first).',
        effect: 'read',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'browser_screenshot',
        description: 'Take a picture of the page shown in the built-in browser, for the person. You cannot see it yourself: read the page instead.',
        effect: 'read',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'browser_act',
        description: 'Act on the page shown in the built-in browser: click an element, type text into a field, or scroll.',
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
