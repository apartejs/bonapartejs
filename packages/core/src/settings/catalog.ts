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
 * Phase 5 adds the settings of the app; the names and help texts the window
 * shows are in its language files.
 */

import type { SettingField } from './resolve.js';

const LIVE = ['global', 'project', 'conversation'] as SettingField['scopes'];

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
  // Minutes without work before the model is unloaded; 0: never.
  { key: 'idleUnloadMinutes', type: 'number', scopes: ['global'], default: 15, min: 0, step: 1, integer: true },
  // Tool round trips allowed in one turn (v0 stopped at 10).
  { key: 'maxToolRounds', type: 'number', scopes: ['global'], default: 25, min: 1, max: 200, step: 1, integer: true },
];

export const SETTINGS: SettingField[] = [...ENGINE_SETTINGS, ...SAMPLING_SETTINGS];

export function settingDefault(key: string): unknown {
  return SETTINGS.find((field) => field.key === key)?.default;
}
