/**
 * Catalog of the harness's settings.
 *
 * The dividing line is structural, not cosmetic:
 *
 * - **Launch** (`scopes: ['global']`): these parameters go into the KV
 *   manifest. Letting them vary per conversation would make the manifest
 *   diverge from the server actually launched — and a restore refused (at
 *   best) or wrongly accepted (at worst). Changing them invalidates saved
 *   states, and the interface must say so beforehand, not after.
 * - **Sampling** (`global` + `conversation`): live, with no effect on the
 *   prompt's prefix, hence no effect on the cache. That's what makes it
 *   legitimate to tune it conversation by conversation.
 */

import type { SettingField } from './resolve.js';

export const SAMPLING_SETTINGS: SettingField[] = [
  {
    key: 'temperature',
    label: 'Température',
    description: 'Plus haut = plus varié. 0 rend la génération quasi déterministe.',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.7,
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    key: 'topP',
    label: 'top_p',
    description: 'Masse de probabilité conservée à chaque token.',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: 'topK',
    label: 'top_k',
    description: 'Nombre de candidats conservés. 0 désactive.',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 40,
    min: 0,
    max: 200,
    step: 1,
    advanced: true,
  },
  {
    key: 'minP',
    label: 'min_p',
    description: 'Seuil relatif au meilleur candidat.',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: 'seed',
    label: 'Graine',
    description: '-1 pour une graine aléatoire à chaque tour.',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: -1,
    step: 1,
    advanced: true,
  },
];

export const LAUNCH_SETTINGS: SettingField[] = [
  {
    key: 'nCtx',
    label: 'Taille de contexte',
    description: 'Tokens que le serveur peut tenir. Entre au manifest KV.',
    type: 'number',
    scopes: ['global'],
    default: 8192,
    min: 512,
    step: 512,
  },
  {
    key: 'nGpuLayers',
    label: 'Couches GPU',
    description: 'Vide = décidé par llama.cpp selon la mémoire disponible.',
    type: 'number',
    scopes: ['global'],
    min: 0,
    step: 1,
  },
  {
    key: 'cacheType',
    label: 'Quantification du cache KV',
    description:
      'K et V partagent le même type : des types asymétriques font tomber ' +
      'llama.cpp dans un chemin lent, en silence.',
    type: 'select',
    scopes: ['global'],
    default: 'f16',
    options: [
      { value: 'f16', label: 'f16 (défaut)' },
      { value: 'q8_0', label: 'q8_0 — moitié moins de mémoire' },
      { value: 'q4_0', label: 'q4_0 — le plus compact' },
    ],
  },
  {
    key: 'flashAttn',
    label: 'Flash attention',
    description:
      'Requis en pratique dès que le cache est quantifié, sinon chaque ' +
      'attention re-déquantifie le cache.',
    type: 'boolean',
    scopes: ['global'],
    default: true,
  },
];

/** All of the harness's settings; plugins add theirs on top. */
export const HARNESS_SETTINGS: SettingField[] = [...SAMPLING_SETTINGS, ...LAUNCH_SETTINGS];

/** The keys whose change invalidates saved KV states. */
export const KV_INVALIDATING_KEYS = new Set(['nCtx', 'cacheType']);
