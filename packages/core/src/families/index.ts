/**
 * The families of models the built-in engine speaks: Gemma (the default of
 * the product) and Qwen; the three others arrive with task 9.4. Until then,
 * a model of another family — or one without a chat template — is refused
 * clearly, with the way out: a service that speaks it.
 */

import { detectFamily, UnsupportedFamilyError } from './detect.js';
import { gemmaLayer } from './gemma/index.js';
import { qwenLayer } from './qwen/index.js';
import type { FamilyId, FamilyLayer } from './types.js';

export type { DemuxEvent, FamilyId, FamilyLayer, GrammarConstraint, StreamDemux } from './types.js';
export { neutralizeControlTokens } from './control-tokens.js';
export { detectFamily, UnsupportedFamilyError } from './detect.js';

const LAYERS: Partial<Record<FamilyId, FamilyLayer>> = {
  gemma: gemmaLayer,
  qwen: qwenLayer,
};

/**
 * The control tokens of every family the app speaks: what a service's server may parse as special in the text it
 * templates — tool results, descriptions, history — whatever model it runs (audit 13.4).
 */
export const EVERY_FAMILY: Pick<FamilyLayer, 'controlTokens'> = {
  controlTokens: [...new Set(Object.values(LAYERS).flatMap((layer) => layer?.controlTokens ?? []))],
};

export function familyLayer(id: FamilyId): FamilyLayer {
  const layer = LAYERS[id];
  if (!layer) throw new UnsupportedFamilyError('unsupported-family', id);
  return layer;
}

/** The layer a model is spoken to through, from the chat template of its GGUF. */
export function layerForModel(model: { chatTemplate?: string | undefined }): FamilyLayer {
  if (!model.chatTemplate) throw new UnsupportedFamilyError('no-chat-template');
  const family = detectFamily(model.chatTemplate);
  if (family === null) throw new UnsupportedFamilyError('unsupported-family');
  return familyLayer(family);
}

/** What a family's system turn opens with, before its text. */
function systemOpening(layer: FamilyLayer): string {
  const one = layer.renderSystem('a');
  const other = layer.renderSystem('b');
  let at = 0;
  while (at < one.length && one[at] === other[at]) at += 1;
  return one.slice(0, at);
}

/** The family a prompt was rendered by, read from how its system turn opens; null when none says. */
export function familyOfPrompt(prompt: string): FamilyId | null {
  for (const layer of Object.values(LAYERS)) if (layer && prompt.startsWith(systemOpening(layer))) return layer.id;
  return null;
}
