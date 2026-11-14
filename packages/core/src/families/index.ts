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
