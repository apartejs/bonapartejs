/**
 * A setting write is a known key, in a scope the setting has, with a value of
 * its declared type (in range, among the options). `undefined` removes an
 * override and is always allowed for a known key. What the window sends is
 * checked here before the engine reads it (security rule 1).
 */

import type { SettingField, SettingScope } from './resolve.js';

const MAX_STRING = 4096;

export function validateSettingValue(fields: SettingField[], scope: SettingScope, key: string, value: unknown): void {
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Unknown setting: ${key}`);
  if (!field.scopes.includes(scope)) throw new Error(`Setting ${key} has no ${scope} scope`);
  if (value === undefined) return;
  switch (field.type) {
    case 'number': {
      if (field.allowAll && value === 'all') return;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Setting ${key} expects a number${field.allowAll ? " or 'all'" : ''}`);
      }
      if (field.integer && !Number.isInteger(value)) throw new Error(`Setting ${key} expects a whole number`);
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        throw new Error(`Setting ${key} is out of range (${field.min ?? '-∞'}…${field.max ?? '∞'})`);
      }
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`Setting ${key} expects a boolean`);
      return;
    case 'select':
      if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
        throw new Error(`Setting ${key} expects one of its options`);
      }
      return;
    case 'string':
      if (typeof value !== 'string') throw new Error(`Setting ${key} expects a string`);
      if (value.length > MAX_STRING) throw new Error(`Setting ${key} is too long`);
      return;
  }
}
