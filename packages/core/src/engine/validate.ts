/**
 * Checks on what crosses the IPC boundary before it reaches the engine or
 * the config (security audit 07, findings 3 and 7). The renderer is ours,
 * but it renders model output: if anything ever got a script into it, the
 * bridge must not hand over "run this program" or "write this anywhere".
 */

import { basename } from 'node:path';
import type { SettingField, SettingScope } from '../settings/resolve.js';

/**
 * The engine binary is a llama.cpp server — `llama-server`, the unified
 * `llama` CLI, or a variant build named after them — never an arbitrary
 * program. The name is the only thing we can check before running it; a
 * wrong binary that passes this is still asked for `/health` and `/props`.
 */
export function assertLlamaBinary(binPath: string): void {
  const name = basename(binPath.replace(/\\/g, '/')).replace(/\.exe$/i, '');
  if (!/^llama(?:[-_][\w.-]+)?$/i.test(name)) {
    throw new Error(
      `The engine must be a llama.cpp server binary (llama-server, or the llama CLI): ${binPath || '(empty)'}`,
    );
  }
}

const MAX_STRING = 4096;

/**
 * A setting write is a known key, in a scope the setting has, with a value
 * of its declared type (in range, among the options). `undefined` removes
 * an override and is always allowed for a known key.
 */
export function validateSettingValue(
  fields: SettingField[],
  scope: SettingScope,
  key: string,
  value: unknown,
): void {
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Unknown setting: ${key}`);
  if (!field.scopes.includes(scope)) throw new Error(`Setting ${key} has no ${scope} scope`);
  if (value === undefined) return;
  switch (field.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Setting ${key} expects a number`);
      }
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        throw new Error(`Setting ${key} is out of range (${field.min ?? '-∞'}…${field.max ?? '∞'})`);
      }
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`Setting ${key} expects a boolean`);
      return;
    case 'select':
      if (typeof value !== 'string' || !(field.options ?? []).some((option) => option.value === value)) {
        throw new Error(`Setting ${key} expects one of its options`);
      }
      return;
    case 'string':
      if (typeof value !== 'string') throw new Error(`Setting ${key} expects a string`);
      if (value.length > MAX_STRING) throw new Error(`Setting ${key} is too long`);
      return;
  }
}
