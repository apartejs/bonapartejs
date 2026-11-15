/**
 * Changing model, said before it is paid (board « Coûts annoncés », 3): the
 * reload, the conversation read again at the new model's speed, and the
 * video memory it takes against what the loaded one takes now. The board's
 * figures are examples; these tests pin the formula. Sizes are binary.
 */

import { describe, expect, it } from 'vitest';
import { announceModelSwitch, type EngineLoadAnnouncement } from './announce.js';

const GiB = 1024 ** 3;
const load: EngineLoadAnnouncement = {
  kind: 'engine-load',
  seconds: 5,
  secondsEstimated: false,
  vramBytes: 4.7 * GiB,
  gpuBytes: 24 * GiB,
  verdict: 'fits',
};

describe('announceModelSwitch', () => {
  it('the reload, the re-reading at the new model’s measured speed, the video memory before and after', () => {
    expect(announceModelSwitch({ load, rereadTokens: 18_400, prefillTokensPerSecond: 920, vramBytesNow: 23.1 * GiB })).toEqual({
      kind: 'model-switch',
      reloadSeconds: 5,
      rereadTokens: 18_400,
      rereadSeconds: 20,
      vramBytes: 4.7 * GiB,
      vramBytesNow: 23.1 * GiB,
      estimated: false,
    });
  });

  it('a model never measured reads at the default speed, and the figures say they are estimates', () => {
    const announced = announceModelSwitch({ load, rereadTokens: 2_000, vramBytesNow: 0 });
    expect(announced.rereadSeconds).toBe(10);
    expect(announced.estimated).toBe(true);
    expect(announceModelSwitch({ load: { ...load, secondsEstimated: true }, rereadTokens: 0, vramBytesNow: 0 }).estimated).toBe(true);
  });

  it('a conversation with nothing to read costs the reload only', () => {
    expect(announceModelSwitch({ load, rereadTokens: 0, vramBytesNow: 0 })).toMatchObject({ rereadTokens: 0, rereadSeconds: 0, estimated: false });
  });
});
