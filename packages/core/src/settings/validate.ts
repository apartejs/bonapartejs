/**
 * A setting write is a known key, in a scope the setting has, with a value of
 * its declared type (in range, among the options). `undefined` removes an
 * override and is always allowed for a known key. What the window sends is
 * checked here before the engine reads it (security rule 1).
 */

import type { SettingField, SettingScope } from './resolve.js';

const MAX_STRING = 4096;
const MAX_ITEMS = 64;
/** A key combination: modifiers then one key, as the window's shortcut registry writes it. */
const COMBO = /^(?:(?:Ctrl|Alt|Shift|Meta)\+){0,4}[^\s+]{1,16}$/;

export function validateSettingValue(fields: SettingField[], scope: SettingScope, key: string, value: unknown): void {
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Unknown setting: ${key}`);
  if (!field.scopes.includes(scope)) throw new Error(`Setting ${key} has no ${scope} scope`);
  // A key, a token, a password: kept in the system's vault, never in a settings file (security rule 10).
  if (field.secret) throw new Error(`Setting ${key} is a secret: it is kept in the vault, never in a settings file`);
  if (value === undefined) return;
  // `null`: a value derived by the app (the disk budget from the free space) until the person sets one.
  if (value === null && field.default === null) return;
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
    case 'keys': {
      const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null;
      if (
        !entries ||
        entries.length > MAX_ITEMS ||
        !entries.every(([action, combo]) => /^[a-zA-Z]{1,64}$/.test(action) && typeof combo === 'string' && (combo === '' || COMBO.test(combo)))
      ) {
        throw new Error(`Setting ${key} expects an action's key combination for each action`);
      }
      return;
    }
    case 'list':
      if (!Array.isArray(value) || value.length > MAX_ITEMS || !value.every((item) => typeof item === 'string' && item.length <= MAX_STRING)) {
        throw new Error(`Setting ${key} expects a list of at most ${MAX_ITEMS} strings`);
      }
      return;
  }
}
