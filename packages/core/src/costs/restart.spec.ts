/**
 * A setting that restarts the engine, said before it is paid (task 7.4;
 * board « Coûts annoncés », 6): what it is, the reload, the memories saved
 * that it would make to read again, and whether a reply runs — which
 * restarting now would cut.
 */

import { describe, expect, it } from 'vitest';
import { memoriesRefusedBy } from '../kv/kv-store.js';
import { announceRestart } from './announce.js';

const saved = (promptTokenCount: number, cache = 'f16') => ({
  modelFingerprint: 'fp',
  promptTokenCount,
  cacheTypeK: cache,
  cacheTypeV: cache,
});

describe('memoriesRefusedBy', () => {
  it('another cache type refuses every memory saved; a smaller context, those that no longer fit', () => {
    const memories = [saved(1_000), saved(9_000), saved(500, 'q8_0')];
    expect(memoriesRefusedBy(memories, { nCtx: 8192, cacheType: 'q8_0' })).toBe(2);
    expect(memoriesRefusedBy(memories, { nCtx: 4096, cacheType: 'f16' })).toBe(2);
    expect(memoriesRefusedBy(memories, { nCtx: 16_384, cacheType: 'f16' })).toBe(1);
  });
});

describe('announceRestart', () => {
  it('says the setting, the reload, the memories to read again, and a reply that runs', () => {
    expect(announceRestart({ setting: 'cacheType', loadSeconds: 22, loadEstimated: false, memoriesLost: 3, replyRunning: true, loaded: true })).toEqual({
      kind: 'restart',
      setting: 'cacheType',
      reloadSeconds: 22,
      estimated: false,
      memoriesLost: 3,
      replyRunning: true,
      loaded: true,
    });
  });

  it('nothing loaded: nothing restarts, the setting applies at the next load', () => {
    expect(announceRestart({ setting: 'nCtx', loadSeconds: 22, loadEstimated: true, memoriesLost: 0, replyRunning: false, loaded: false })).toMatchObject({
      loaded: false,
      reloadSeconds: 0,
    });
  });
});
