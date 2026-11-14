/**
 * A setting written by the window is checked before the engine reads it: a
 * known key, a scope it has, a value of its type (security rule 1 — what
 * crosses the bridge is validated).
 */

import { describe, expect, it } from 'vitest';
import type { SettingField } from './resolve.js';
import { validateSettingValue } from './validate.js';

const fields: SettingField[] = [
  { key: 'temperature', type: 'number', scopes: ['global', 'conversation'], min: 0, max: 2 },
  { key: 'thinking', type: 'boolean', scopes: ['conversation'] },
  { key: 'cacheType', type: 'select', scopes: ['global'], options: ['f16', 'q8_0'] },
  { key: 'gpuLayers', type: 'number', scopes: ['global'], min: 0, integer: true, allowAll: true },
  { key: 'plugin:web:apiKey', type: 'string', scopes: ['global'] },
];

describe('validateSettingValue', () => {
  it('accepts a value of the declared type, in range, in scope', () => {
    expect(() => validateSettingValue(fields, 'global', 'temperature', 0.7)).not.toThrow();
    expect(() => validateSettingValue(fields, 'conversation', 'thinking', false)).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'cacheType', 'q8_0')).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'plugin:web:apiKey', 'abc')).not.toThrow();
  });

  it("accepts 'all' or a whole number of GPU layers", () => {
    expect(() => validateSettingValue(fields, 'global', 'gpuLayers', 'all')).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'gpuLayers', 20)).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'gpuLayers', 2.5)).toThrow(/whole/i);
    expect(() => validateSettingValue(fields, 'global', 'gpuLayers', 'some')).toThrow(/number/i);
    expect(() => validateSettingValue(fields, 'global', 'temperature', 'all')).toThrow(/number/i);
  });

  it('undefined removes an override: always allowed for a known key', () => {
    expect(() => validateSettingValue(fields, 'global', 'temperature', undefined)).not.toThrow();
  });

  it('refuses an unknown key, a scope the setting does not have, a wrong type, an out-of-range number, an unlisted option', () => {
    expect(() => validateSettingValue(fields, 'global', 'binPath', 'C:\\evil.exe')).toThrow(/unknown/i);
    expect(() => validateSettingValue(fields, 'conversation', 'cacheType', 'f16')).toThrow(/scope/i);
    expect(() => validateSettingValue(fields, 'global', 'temperature', '0.7')).toThrow(/number/i);
    expect(() => validateSettingValue(fields, 'global', 'temperature', 9)).toThrow(/range/i);
    expect(() => validateSettingValue(fields, 'global', 'temperature', Number.NaN)).toThrow(/number/i);
    expect(() => validateSettingValue(fields, 'conversation', 'thinking', 'yes')).toThrow(/boolean/i);
    expect(() => validateSettingValue(fields, 'global', 'cacheType', 'q2_k')).toThrow(/option/i);
    expect(() => validateSettingValue(fields, 'global', 'plugin:web:apiKey', 'x'.repeat(5000))).toThrow(/long/i);
  });
});
