/**
 * The families of models the built-in engine speaks. Qwen is the first; the
 * four others arrive with task 9.4, and until then asking for one is refused
 * clearly (task 2.5 says how).
 */

import { qwenLayer } from './qwen/index.js';
import type { FamilyId, FamilyLayer } from './types.js';

export type { DemuxEvent, FamilyId, FamilyLayer, GrammarConstraint, StreamDemux } from './types.js';
export { neutralizeControlTokens } from './control-tokens.js';

const LAYERS: Partial<Record<FamilyId, FamilyLayer>> = {
  qwen: qwenLayer,
};

export function familyLayer(id: FamilyId): FamilyLayer {
  const layer = LAYERS[id];
  if (!layer) throw new Error(`The built-in engine does not speak the ${id} family yet.`);
  return layer;
}
