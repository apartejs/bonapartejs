/**
 * The settings of the engine and of sampling: structure only — keys, scopes,
 * defaults, bounds. What the window shows of them lives in its language
 * files, like every string of the interface.
 */

import { describe, expect, it } from 'vitest';
import { ENGINE_SETTINGS, SAMPLING_SETTINGS, SETTINGS, settingDefault } from './catalog.js';

describe('the catalog', () => {
  it('has the defaults of the engine', () => {
    expect(settingDefault('gpuLayers')).toBe('all');
    expect(settingDefault('nCtx')).toBe(8192);
    expect(settingDefault('cacheType')).toBe('f16');
    expect(settingDefault('idleUnloadMinutes')).toBe(15);
    expect(settingDefault('maxToolRounds')).toBe(25);
  });

  it('keeps the launch parameters global: they go into the KV manifest', () => {
    for (const key of ['nCtx', 'gpuLayers', 'cacheType']) {
      const field = ENGINE_SETTINGS.find((candidate) => candidate.key === key)!;
      expect(field.scopes, key).toEqual(['global']);
      // Changing one restarts the engine: the window says so before.
      expect(field.requiresRestart, key).toBe(true);
    }
  });

  it('lets sampling vary by project and by conversation: it costs the cache nothing', () => {
    for (const field of SAMPLING_SETTINGS) {
      expect(field.scopes, field.key).toEqual(['global', 'project', 'conversation']);
      expect(field.requiresRestart, field.key).toBeFalsy();
    }
  });

  it('defines each key once', () => {
    const keys = SETTINGS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no text of the interface: labels live in the window', () => {
    for (const field of SETTINGS) {
      expect(Object.keys(field)).not.toContain('label');
      expect(Object.keys(field)).not.toContain('description');
    }
  });
});
