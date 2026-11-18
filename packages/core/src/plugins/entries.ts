/**
 * The built-in entries of the core on the Plugins page (task 11.3): features of the core that the person switches
 * off as a plugin — for the app, or for one project — and that the core follows. They have no Node half of their own
 * and add no tool: « Sous-agents » keeps `run_subagent` in the inventory or takes it out; « Scripts du projet » lets
 * the new tab list what the project runs; « Titres automatiques » lets the window title a conversation from its
 * first message.
 */

import type { PluginManifestInput } from '@aparte/bonaparte-shared';

export const CORE_ENTRIES: readonly PluginManifestInput[] = [
  {
    id: 'subagents',
    name: { en: 'Sub-agents', fr: 'Sous-agents' },
    version: '1.0.0',
    description: {
      en: 'The agent hands parts of a task to other agents, one line each, under the same permissions.',
      fr: 'L’agent confie des parties d’une tâche à d’autres agents, une ligne chacun, sous les mêmes permissions.',
    },
    effects: [{ effect: 'execute', what: { en: 'other agents, under the same permissions', fr: 'd’autres agents, sous les mêmes permissions' } }],
  },
  {
    id: 'project-scripts',
    name: { en: 'Project scripts', fr: 'Scripts du projet' },
    version: '1.0.0',
    description: {
      en: 'The scripts of package.json, launched in one click in the terminal.',
      fr: 'Les scripts de package.json, lancés en un clic dans le terminal.',
    },
    effects: [{ effect: 'execute', what: { en: 'the scripts of the project', fr: 'les scripts du projet' } }],
  },
  {
    id: 'conversation-settings',
    name: { en: 'Conversation settings', fr: 'Réglages de conversation' },
    version: '1.0.0',
    description: {
      en: 'Temperature, reasoning and context cap, conversation by conversation.',
      fr: 'Température, réflexion et plafond de contexte, conversation par conversation.',
    },
    effects: [],
  },
  {
    id: 'resource-monitor',
    name: { en: 'Resource monitor', fr: 'Moniteur de ressources' },
    version: '1.0.0',
    description: {
      en: 'Processor, memory and graphics card, live.',
      fr: 'Processeur, mémoire et carte graphique, en direct.',
    },
    effects: [],
  },
  {
    id: 'auto-titles',
    name: { en: 'Automatic titles', fr: 'Titres automatiques' },
    version: '1.0.0',
    description: {
      en: 'A title for each conversation, taken from its first message.',
      fr: 'Un titre pour chaque conversation, tiré de son premier message.',
    },
    effects: [],
  },
];

/** The tool each entry keeps in the inventory, or takes out when it is switched off. */
export const ENTRY_TOOLS: Readonly<Record<string, string>> = { subagents: 'run_subagent' };
