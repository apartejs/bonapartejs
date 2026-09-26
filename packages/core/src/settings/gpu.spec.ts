/**
 * Whether the interface asks for the GPU (P3.1, D-23). Off by default: every
 * megabyte of VRAM the interface leaves is the model's. On when asked; and
 * `auto` gives it to the one plugin that renders real pages — the browser —
 * only while that plugin is on. Read before the app is ready, from the saved
 * config: Chromium fixes its GPU mode at startup.
 */

import { describe, expect, it } from 'vitest';
import { LAUNCH_SETTINGS } from './catalog.js';
import { wantsGpuAcceleration } from './gpu.js';

describe('wantsGpuAcceleration', () => {
  it('is off by default, and with anything it does not recognise', () => {
    expect(wantsGpuAcceleration({})).toBe(false);
    expect(wantsGpuAcceleration({ settings: { gpuAcceleration: 'off' } })).toBe(false);
    expect(wantsGpuAcceleration({ settings: { gpuAcceleration: true } })).toBe(false);
    expect(wantsGpuAcceleration({ settings: { gpuAcceleration: 'yes' } })).toBe(false);
    expect(wantsGpuAcceleration(null)).toBe(false);
    expect(wantsGpuAcceleration('garbage')).toBe(false);
  });

  it('is on when asked', () => {
    expect(wantsGpuAcceleration({ settings: { gpuAcceleration: 'on' } })).toBe(true);
  });

  it('auto: on while the browser plugin is on, off once it is switched off', () => {
    expect(wantsGpuAcceleration({ settings: { gpuAcceleration: 'auto' } })).toBe(true);
    expect(
      wantsGpuAcceleration({ settings: { gpuAcceleration: 'auto' }, disabledPlugins: ['terminal'] }),
    ).toBe(true);
    expect(
      wantsGpuAcceleration({ settings: { gpuAcceleration: 'auto' }, disabledPlugins: ['browser'] }),
    ).toBe(false);
  });

  it('is a launch setting of the catalog, off by default, with its three choices', () => {
    const field = LAUNCH_SETTINGS.find((setting) => setting.key === 'gpuAcceleration');
    expect(field?.scopes).toEqual(['global']);
    expect(field?.default).toBe('off');
    expect(field?.options?.map((option) => option.value)).toEqual(['off', 'auto', 'on']);
  });
});
