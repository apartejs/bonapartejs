import { describe, expect, it } from 'vitest';
import { resolveSettings, type SettingField } from './resolve.js';

const fields: SettingField[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.7,
  },
  {
    key: 'nCtx',
    label: 'Context size',
    type: 'number',
    // A LAUNCH parameter: it goes into the KV manifest, so it cannot be
    // set per conversation.
    scopes: ['global'],
    default: 8192,
  },
];

const byKey = (resolved: ReturnType<typeof resolveSettings>, key: string) =>
  resolved.find((setting) => setting.key === key);

describe('resolveSettings', () => {
  it('with no override, the value comes from the default and says so', () => {
    const resolved = resolveSettings(fields, {}, 'conversation');
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.7,
      from: 'default',
      overridden: false,
    });
  });

  it('the global setting wins over the default', () => {
    const resolved = resolveSettings(fields, { global: { temperature: 0.3 } }, 'global');
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });

  it('the conversation setting wins over the global one', () => {
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, conversation: { temperature: 0.9 } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.9,
      from: 'conversation',
      overridden: true,
    });
  });

  it('says WHAT the value is inherited from when it is not overridden', () => {
    // This is what lets the UI write "inherited from the global setting
    // (0.3)" instead of showing a field whose origin is unknown.
    const resolved = resolveSettings(fields, { global: { temperature: 0.3 } }, 'conversation');
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.3,
      from: 'global',
      overridden: false,
      inheritedFrom: 'global',
    });
  });

  it('exposes in a scope only the settings that can be set there', () => {
    const conversation = resolveSettings(fields, {}, 'conversation');
    expect(conversation.map((s) => s.key)).toEqual(['temperature']);

    const global = resolveSettings(fields, {}, 'global');
    expect(global.map((s) => s.key)).toEqual(['temperature', 'nCtx']);
  });

  it('ignores an override from a forbidden scope rather than applying it', () => {
    // A conversation cannot change nCtx: accepting it would make the KV
    // manifest diverge from the server actually launched.
    const resolved = resolveSettings(
      fields,
      { conversation: { nCtx: 32768 } },
      'global',
    );
    expect(byKey(resolved, 'nCtx')?.value).toBe(8192);
  });

  it('falls back to the default when an override is undefined', () => {
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, conversation: { temperature: undefined } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });
});
