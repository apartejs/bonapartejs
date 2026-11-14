import { describe, expect, it } from 'vitest';
import { resolveSettings, type SettingField } from './resolve.js';

const fields: SettingField[] = [
  { key: 'temperature', type: 'number', scopes: ['global', 'project', 'conversation'], default: 0.7 },
  // A LAUNCH parameter: it goes into the KV manifest, so it cannot be set
  // per conversation, nor per project.
  { key: 'nCtx', type: 'number', scopes: ['global'], default: 8192 },
];

const byKey = (resolved: ReturnType<typeof resolveSettings>, key: string) =>
  resolved.find((setting) => setting.key === key);

describe('resolveSettings', () => {
  it('with no override, the value comes from the default and says so', () => {
    expect(byKey(resolveSettings(fields, {}, 'conversation'), 'temperature')).toMatchObject({
      value: 0.7,
      from: 'default',
      overridden: false,
    });
  });

  it('the global setting wins over the default', () => {
    const resolved = resolveSettings(fields, { global: { temperature: 0.3 } }, 'global');
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });

  it('the project wins over the global setting, and the conversation over the project', () => {
    const layers = { global: { temperature: 0.3 }, project: { temperature: 0.5 } };
    expect(byKey(resolveSettings(fields, layers, 'project'), 'temperature')).toMatchObject({
      value: 0.5,
      from: 'project',
      overridden: true,
    });
    const withConversation = { ...layers, conversation: { temperature: 0.9 } };
    expect(byKey(resolveSettings(fields, withConversation, 'conversation'), 'temperature')).toMatchObject({
      value: 0.9,
      from: 'conversation',
      overridden: true,
    });
  });

  it('says WHAT the value is inherited from when it is not overridden', () => {
    // What lets the window write "inherited from the project (0.5)".
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, project: { temperature: 0.5 } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.5,
      from: 'project',
      overridden: false,
      inheritedFrom: 'project',
    });
  });

  it('exposes in a scope only the settings that can be set there', () => {
    expect(resolveSettings(fields, {}, 'conversation').map((s) => s.key)).toEqual(['temperature']);
    expect(resolveSettings(fields, {}, 'project').map((s) => s.key)).toEqual(['temperature']);
    expect(resolveSettings(fields, {}, 'global').map((s) => s.key)).toEqual(['temperature', 'nCtx']);
  });

  it('ignores an override from a forbidden scope rather than applying it', () => {
    // Accepting it would make the KV manifest diverge from the server launched.
    const resolved = resolveSettings(fields, { project: { nCtx: 16384 }, conversation: { nCtx: 32768 } }, 'global');
    expect(byKey(resolved, 'nCtx')?.value).toBe(8192);
  });

  it('falls back to the layer below when an override is undefined', () => {
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, conversation: { temperature: undefined } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });
});
