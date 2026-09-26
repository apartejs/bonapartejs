/**
 * What crosses the IPC boundary is checked before it reaches the engine or
 * the config (security audit 07, finding 3 and 7): the renderer names the
 * binary the harness will execute, and writes settings the engine reads.
 */

import { describe, expect, it } from 'vitest';
import type { SettingField } from '../settings/resolve.js';
import { assertLlamaBinary, validateSettingValue } from './validate.js';

describe('assertLlamaBinary — the engine is a llama.cpp server, not any program', () => {
  it.each([
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\llama.exe',
    'C:\\tools\\llama.cpp\\llama-server.exe',
    '/usr/local/bin/llama-server',
    'D:\\bin\\llama-server-cuda.exe',
    'llama',
  ])('accepts %s', (path) => {
    expect(() => assertLlamaBinary(path)).not.toThrow();
  });

  it.each([
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    '/bin/sh',
    'C:\\Users\\me\\Downloads\\not-llama.exe',
    'C:\\tools\\llama.cmd',
    '',
  ])('refuses %s', (path) => {
    expect(() => assertLlamaBinary(path)).toThrow(/llama/);
  });
});

describe('validateSettingValue — a known setting, a value of its type', () => {
  const fields: SettingField[] = [
    { key: 'temperature', label: { en: 'T', fr: 'T' }, type: 'number', scopes: ['global', 'conversation'], min: 0, max: 2 },
    { key: 'thinking', label: { en: 'R', fr: 'R' }, type: 'boolean', scopes: ['conversation'] },
    {
      key: 'cacheType',
      label: { en: 'C', fr: 'C' },
      type: 'select',
      scopes: ['global'],
      options: [
        { value: 'f16', label: { en: 'f16', fr: 'f16' } },
        { value: 'q8_0', label: { en: 'q8', fr: 'q8' } },
      ],
    },
    { key: 'plugin:web:apiKey', label: { en: 'K', fr: 'K' }, type: 'string', scopes: ['global'] },
  ];

  it('accepts a value of the declared type, in range, in scope', () => {
    expect(() => validateSettingValue(fields, 'global', 'temperature', 0.7)).not.toThrow();
    expect(() => validateSettingValue(fields, 'conversation', 'thinking', false)).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'cacheType', 'q8_0')).not.toThrow();
    expect(() => validateSettingValue(fields, 'global', 'plugin:web:apiKey', 'abc')).not.toThrow();
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
