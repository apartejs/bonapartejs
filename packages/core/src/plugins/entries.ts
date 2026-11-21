/**
 * The built-in entries of the core on the Plugins page (task 11.3): features of the core that the person switches
 * off as a plugin — for the app, or for one project — and that the core follows. They have no Node half of their own
 * and add no tool: « Sous-agents » keeps `run_subagent` in the inventory or takes it out, « Plugins créés en
 * conversation » the tools that make a plugin (off by default); « Scripts du projet » lets
 * the new tab list what the project runs; « Titres automatiques » lets the window title a conversation from its
 * first message.
 */

import type { PluginManifestInput } from '@aparte/bonaparte-shared';

export const CORE_ENTRIES: readonly PluginManifestInput[] = [
  {
    id: 'subagents',
    name: { en: 'Sub-agents', fr: 'Sous-agents' },
    version: '0.1.0',
    description: {
      en: 'The agent hands parts of a task to other agents, one line each, under the same permissions.',
      fr: 'L’agent confie des parties d’une tâche à d’autres agents, une ligne chacun, sous les mêmes permissions.',
    },
    effects: [{ effect: 'execute', what: { en: 'other agents, under the same permissions', fr: 'd’autres agents, sous les mêmes permissions' } }],
  },
  {
    id: 'project-scripts',
    name: { en: 'Project scripts', fr: 'Scripts du projet' },
    version: '0.1.0',
    description: {
      en: 'The scripts of package.json, launched in one click in the terminal.',
      fr: 'Les scripts de package.json, lancés en un clic dans le terminal.',
    },
    effects: [{ effect: 'execute', what: { en: 'the scripts of the project', fr: 'les scripts du projet' } }],
  },
  {
    id: 'conversation-settings',
    name: { en: 'Conversation settings', fr: 'Réglages de conversation' },
    version: '0.1.0',
    description: {
      en: 'Temperature, reasoning and context cap, conversation by conversation.',
      fr: 'Température, réflexion et plafond de contexte, conversation par conversation.',
    },
    effects: [],
  },
  {
    id: 'resource-monitor',
    name: { en: 'Resource monitor', fr: 'Moniteur de ressources' },
    version: '0.1.0',
    description: {
      en: 'Processor, memory and graphics card, live.',
      fr: 'Processeur, mémoire et carte graphique, en direct.',
    },
    effects: [],
  },
  {
    // Off until the person switches it on, or a conversation asks for it (« / plugin »): its five tools weigh some
    // 900 tokens in every prompt (audit 2026-11-21, I2).
    id: 'conversation-plugins',
    name: { en: 'Plugins made in a conversation', fr: 'Plugins créés en conversation' },
    version: '0.1.0',
    description: {
      en: 'The agent writes a plugin in any conversation, tries it there and offers to install it. Without it, only a conversation that asks with « / plugin ».',
      fr: 'L’agent écrit un plugin dans toute conversation, l’essaie là et propose de l’installer. Sans lui, seulement une conversation qui le demande avec « / plugin ».',
    },
    effects: [{ effect: 'execute', what: { en: 'the plugins the agent writes, tried in their conversation', fr: 'les plugins que l’agent écrit, essayés dans leur conversation' } }],
  },
  {
    id: 'auto-titles',
    name: { en: 'Automatic titles', fr: 'Titres automatiques' },
    version: '0.1.0',
    description: {
      en: 'A title for each conversation, taken from its first message.',
      fr: 'Un titre pour chaque conversation, tiré de son premier message.',
    },
    effects: [],
  },
];

/** The tools each entry keeps in the inventory, or takes out when it is switched off. */
export const ENTRY_TOOLS: Readonly<Record<string, readonly string[]>> = {
  subagents: ['run_subagent'],
  'conversation-plugins': ['harness_inspect', 'extension_define', 'extension_run', 'extension_stop', 'extension_undefine'],
};

/** The entries off until the person switches them on: their tools only where a conversation asks for them. */
export const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['conversation-plugins']);

/** The entry a conversation asks for with its « / » command, its tools then in its inventory whatever the switch. */
export const ASKED_ENTRY = 'conversation-plugins';
