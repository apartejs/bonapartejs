/**
 * The settings of the engine and of sampling: structure only — keys, scopes,
 * defaults, bounds. What the window shows of them lives in its language
 * files, like every string of the interface.
 */

import { describe, expect, it } from 'vitest';
import { ENGINE_SETTINGS, SAMPLING_SETTINGS, SETTINGS, settingDefault } from './catalog.js';
import { resolveSettings } from './resolve.js';
import { validateSettingValue } from './validate.js';

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

describe('the settings of the app (task 5.2)', () => {
  it('has the defaults of the plan and of the boards', () => {
    const defaults: Record<string, unknown> = {
      language: 'system',
      sidebarGrouping: 'project',
      autoOpenPanel: 'approval',
      newConversationWorksIn: 'folder',
      subagentsOnBuiltin: 'sequential',
      subagentsEngine: 'conversation',
      askBeforeNetwork: true,
      maxToolRounds: 25,
      idleUnloadMinutes: 15,
      closeToTray: true,
      launchAtLogin: false,
      reopenLast: true,
      theme: 'system',
      accent: 'blue',
      textSize: 'normal',
      listDensity: 'comfortable',
      codeFont: 'JetBrains Mono',
      defaultModel: '',
      modelFolders: [],
      branchPrefix: 'bonaparte/',
      autoUpdateApp: true,
      'notifications.replyDone': 'banner',
      'notifications.approval': 'banner',
      'notifications.question': 'badge',
      'notifications.failure': 'banner',
      gpuLayers: 'all',
    };
    for (const [key, value] of Object.entries(defaults)) expect(settingDefault(key), key).toEqual(value);
    // The disk budget is derived from the free space (task 3.4) until the person sets one.
    expect(SETTINGS.find((field) => field.key === 'kvBudgetBytes')).toMatchObject({ type: 'number', default: null });
  });

  it('no « coder ou discuter » profile: what it chose follows from the project (Paul, 18/11)', () => {
    expect(SETTINGS.map((field) => field.key)).not.toContain('profile');
  });

  it('the choices the boards offer, and nothing else', () => {
    const options = (key: string) => SETTINGS.find((field) => field.key === key)?.options;
    expect(options('accent')).toEqual(['blue', 'teal', 'violet', 'orange']);
    expect(options('autoOpenPanel')).toEqual(['never', 'approval', 'always']);
    expect(options('textSize')).toEqual(['small', 'normal', 'large']);
    expect(options('listDensity')).toEqual(['comfortable', 'compact']);
    expect(options('theme')).toEqual(['system', 'light', 'dark']);
    expect(options('notifications.question')).toEqual(['banner', 'badge', 'off']);
  });

  it("a project's setting comes before the global one", () => {
    const resolved = resolveSettings(SETTINGS, { global: { newConversationWorksIn: 'folder' }, project: { newConversationWorksIn: 'branch' } }, 'project');
    expect(resolved.find((setting) => setting.key === 'newConversationWorksIn')).toMatchObject({ value: 'branch', from: 'project' });
  });

  it('an API key is never written to a settings file: a secret goes to the vault', () => {
    const fields = [...SETTINGS, { key: 'providerKey', type: 'string' as const, scopes: ['global' as const], secret: true }];
    expect(() => validateSettingValue(fields, 'global', 'providerKey', 'sk-live-123')).toThrow(/vault/);
  });

  it('a list of folders is a list of paths, and nothing else', () => {
    expect(() => validateSettingValue(SETTINGS, 'global', 'modelFolders', ['D:/models'])).not.toThrow();
    expect(() => validateSettingValue(SETTINGS, 'global', 'modelFolders', 'D:/models')).toThrow();
    expect(() => validateSettingValue(SETTINGS, 'global', 'modelFolders', [3])).toThrow();
  });
});
