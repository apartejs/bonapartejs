/**
 * The settings of the engine, and of sampling. The dividing line is
 * structural:
 *
 * - **Launch** (`global` only, `requiresRestart`): these go into the KV
 *   manifest. Changing one restarts the engine, and the window says what
 *   that costs before.
 * - **Sampling** (`global`, `project`, `conversation`): live, with no effect
 *   on the prefix of the prompt, hence none on the cache.
 *
 * - **The app** (task 5.2): the interface, the conversations, the
 *   notifications — global, a few also by project.
 *
 * The names and help texts the window shows are in its language files.
 */

import type { SettingField } from './resolve.js';

const LIVE = ['global', 'project', 'conversation'] as SettingField['scopes'];

// No store holds these for the app or a project yet: a turn samples as its model's family recommends
// (`FamilyLayer.sampling`), with the conversation's own temperature over it (audit 2026-11-21, D6).
export const SAMPLING_SETTINGS: SettingField[] = [
  // Decided by the suffix of the next turn only: the frozen prefix never
  // changes, so this is a live choice.
  { key: 'thinking', type: 'boolean', scopes: LIVE, default: true },
  { key: 'temperature', type: 'number', scopes: LIVE, default: 0.7, min: 0, max: 2, step: 0.05 },
  { key: 'topP', type: 'number', scopes: LIVE, default: 0.95, min: 0, max: 1, step: 0.01, advanced: true },
  { key: 'topK', type: 'number', scopes: LIVE, default: 40, min: 0, max: 200, step: 1, integer: true, advanced: true },
  { key: 'minP', type: 'number', scopes: LIVE, default: 0.05, min: 0, max: 1, step: 0.01, advanced: true },
  { key: 'seed', type: 'number', scopes: LIVE, default: -1, step: 1, integer: true, advanced: true },
];

export const ENGINE_SETTINGS: SettingField[] = [
  // The context of each conversation (each slot).
  { key: 'nCtx', type: 'number', scopes: ['global'], default: 8192, min: 512, step: 512, integer: true, requiresRestart: true },
  // 'all' or a number: the rest of the model then runs on the processor —
  // announced as slower before it is chosen.
  {
    key: 'gpuLayers',
    type: 'number',
    scopes: ['global'],
    default: 'all',
    min: 0,
    step: 1,
    integer: true,
    allowAll: true,
    advanced: true,
    requiresRestart: true,
  },
  // K and V share one type: an asymmetric pair drops llama.cpp onto a slow path.
  { key: 'cacheType', type: 'select', scopes: ['global'], default: 'f16', options: ['f16', 'q8_0', 'q4_0'], requiresRestart: true },
  // Tool round trips allowed in one turn (v0 stopped at 10).
  { key: 'maxToolRounds', type: 'number', scopes: ['global'], default: 25, min: 1, max: 200, step: 1, integer: true },
];

const GLOBAL = ['global'] as SettingField['scopes'];
const BY_PROJECT = ['global', 'project'] as SettingField['scopes'];
const NOTIFY = ['banner', 'badge', 'off'];

export const APP_SETTINGS: SettingField[] = [
  // « Comme Windows » by default: French when the system speaks it, English otherwise.
  { key: 'language', type: 'select', scopes: GLOBAL, default: 'system', options: ['system', 'fr', 'en'] },
  { key: 'sidebarGrouping', type: 'select', scopes: GLOBAL, default: 'project', options: ['project', 'single'] },
  { key: 'autoOpenPanel', type: 'select', scopes: GLOBAL, default: 'approval', options: ['never', 'approval', 'always'] },
  { key: 'newConversationWorksIn', type: 'select', scopes: BY_PROJECT, default: 'folder', options: ['folder', 'branch'] },
  { key: 'branchPrefix', type: 'string', scopes: BY_PROJECT, default: 'bonaparte/' },
  // In parallel, the engine runs one slot per sub-agent: a restart, announced (task 8.3).
  { key: 'subagentsOnBuiltin', type: 'select', scopes: GLOBAL, default: 'sequential', options: ['sequential', 'parallel'], requiresRestart: true },
  // « Moteur des sous-agents » (audit S1): the conversation's own engine, or a service and one of its models,
  // `<provider id>/<model>` (`agent/service-subagent.ts`).
  { key: 'subagentsEngine', type: 'string', scopes: GLOBAL, default: 'conversation' },
  // The web search (task 10.4): the public engine read in a hidden page, or an online provider whose key is in
  // the vault; a SearXNG's address.
  { key: 'webSearchProvider', type: 'select', scopes: GLOBAL, default: 'embedded', options: ['embedded', 'brave', 'tavily', 'serper', 'searxng'] },
  { key: 'webSearchUrl', type: 'string', scopes: GLOBAL, default: '' },
  { key: 'askBeforeNetwork', type: 'boolean', scopes: BY_PROJECT, default: true },
  // The files the person adds to « toujours demandé » (Settings, Permissions): asked in every mode.
  { key: 'alwaysAsk', type: 'list', scopes: BY_PROJECT, default: [] },
  // The mode a conversation without a project starts in (Settings, Permissions).
  { key: 'defaultMode', type: 'select', scopes: GLOBAL, default: 'repetition', options: ['lecture', 'repetition', 'plume', 'impro'] },
  { key: 'closeToTray', type: 'boolean', scopes: GLOBAL, default: true },
  { key: 'launchAtLogin', type: 'boolean', scopes: GLOBAL, default: false },
  { key: 'reopenLast', type: 'boolean', scopes: GLOBAL, default: true },
  { key: 'theme', type: 'select', scopes: GLOBAL, default: 'system', options: ['system', 'light', 'dark'] },
  { key: 'accent', type: 'select', scopes: GLOBAL, default: 'blue', options: ['blue', 'teal', 'violet', 'orange'] },
  { key: 'textSize', type: 'select', scopes: GLOBAL, default: 'normal', options: ['small', 'normal', 'large'] },
  { key: 'listDensity', type: 'select', scopes: GLOBAL, default: 'comfortable', options: ['comfortable', 'compact'] },
  { key: 'codeFont', type: 'string', scopes: GLOBAL, default: 'JetBrains Mono' },
  // None: the person chooses (task 5.7).
  { key: 'defaultModel', type: 'string', scopes: GLOBAL, default: '' },
  // Minutes without work before the model is unloaded; 0: never. No launch argument: it applies at once (7.4).
  { key: 'idleUnloadMinutes', type: 'number', scopes: GLOBAL, default: 15, min: 0, step: 1, integer: true },
  { key: 'modelFolders', type: 'list', scopes: GLOBAL, default: [] },
  // Derived from the free space (task 3.4) until the person sets one.
  { key: 'kvBudgetBytes', type: 'number', scopes: GLOBAL, default: null, min: 0, step: 1, integer: true, advanced: true },
  // Off until the person says so: a download nobody announced is a cost not said first (review of round 6).
  { key: 'autoUpdateApp', type: 'boolean', scopes: GLOBAL, default: false },
  // « Garder la version actuelle » (task 13.1): the catalogue's ids whose new version is never offered again.
  { key: 'keptModels', type: 'list', scopes: GLOBAL, default: [] },
  // The shortcuts the person changed (task 12.1): an action's id → its keys, '' for none; the others keep their default.
  { key: 'shortcuts', type: 'keys', scopes: GLOBAL, default: {} },
  { key: 'notifications.replyDone', type: 'select', scopes: GLOBAL, default: 'banner', options: NOTIFY },
  { key: 'notifications.approval', type: 'select', scopes: GLOBAL, default: 'banner', options: NOTIFY },
  { key: 'notifications.question', type: 'select', scopes: GLOBAL, default: 'badge', options: NOTIFY },
  { key: 'notifications.failure', type: 'select', scopes: GLOBAL, default: 'banner', options: NOTIFY },
];

export const SETTINGS: SettingField[] = [...ENGINE_SETTINGS, ...SAMPLING_SETTINGS, ...APP_SETTINGS];

export function settingDefault(key: string): unknown {
  return SETTINGS.find((field) => field.key === key)?.default;
}
