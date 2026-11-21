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
  version: '0.1.0',
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
          'Open a page or a file in your own browser tab, then read it with browser_read. ' +
          'Give url for an http(s) address (of the internet, or of this machine: localhost:5173), or path for a file of the project as for read_file (index.html). ' +
          'Your tab is a session of its own, with none of the user’s logins or cookies; a private network address is refused.',
        effect: 'network',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'An http(s) address.' },
            path: { type: 'string', description: 'Or the path of a file of the project, as for read_file.' },
          },
        },
        // A discussion has no folder: it is told the web pages only (review of round 3, 6 and 7).
        discussion: {
          description:
            'Open a web page in your own browser tab, then read it with browser_read. ' +
            'Give url, an http(s) address (of the internet, or of this machine: localhost:5173). ' +
            'Your tab is a session of its own, with none of the user’s logins or cookies; a private network address is refused.',
          inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'An http(s) address.' } } },
        },
      },
      {
        // Kept for the conversations told of it before: one tool opens a page or a file now (Paul, 2026-11-20).
        name: 'browser_open_file',
        description: 'Replaced by browser_open: give it the same path to open a file in your own browser tab.',
        effect: 'read',
        hidden: true,
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
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
          'Act on the page in your own browser tab, never on one of the user’s: click an element or type text into a field (give a CSS selector), or scroll. ' +
          'Read the page again afterwards to see the result. ' +
          'Typing a password or a card number, sending a form and choosing a file to upload are refused unless you set "confirm": true, which always asks the user first.',
        effect: 'execute',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['click', 'type', 'scroll'] },
            selector: { type: 'string', description: 'A CSS selector, for click and type.' },
            text: { type: 'string', description: 'What to type.' },
            by: { type: 'number', description: 'Pixels to scroll, down when positive.' },
            confirm: { type: 'boolean', description: 'true only to do what was refused as always asked of the user: the user is asked first.' },
          },
          required: ['action'],
        },
      },
    ],
  },
});
