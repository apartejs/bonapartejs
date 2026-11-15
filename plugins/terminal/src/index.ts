/**
 * The built-in terminal (task 6.6): its manifest, read before anything of
 * it runs, and its Node half. Its view is the app's (built with it, sharing
 * its React); the pseudo-terminals are the app's, in a process of their own.
 */

import { defineManifest } from '@aparte/bonaparte-plugin-sdk';

export { MAX_HISTORY_CHARS, terminal } from './node.js';

export const terminalManifest = defineManifest({
  id: 'terminal',
  name: { en: 'Terminal', fr: 'Terminal' },
  version: '1.0.0',
  description: { en: 'A terminal per tab, in the project; the agent’s commands in their own tab.', fr: 'Un terminal par onglet, dans le projet ; les commandes de l’agent dans leur onglet.' },
  effects: [{ effect: 'execute', what: { en: 'a shell of this machine, in a terminal you type in', fr: 'un shell de cette machine, dans un terminal où tu tapes' } }],
  contributes: {
    panes: [{ id: 'terminal', title: { en: 'Terminal', fr: 'Terminal' }, multiple: true, shortcut: 'Ctrl+`' }],
  },
});
