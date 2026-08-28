import type { LocalizedText } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { HARNESS_SETTINGS, KV_INVALIDATING_KEYS } from './catalog.js';

// The catalog's labels are shown in the settings hub and in the
// conversation settings: UI strings, so both locales, like everywhere else.
// They used to be French-only, whatever the user's language.
function expectBilingual(text: LocalizedText | undefined, where: string): void {
  expect(typeof text, `${where} should carry both locales`).toBe('object');
  const both = text as { en?: string; fr?: string };
  expect(both.en, `${where} lacks an English label`).toBeTruthy();
  expect(both.fr, `${where} lacks a French label`).toBeTruthy();
}

describe('settings catalog', () => {
  it('every label, description and option carries both locales', () => {
    for (const field of HARNESS_SETTINGS) {
      expectBilingual(field.label, `${field.key}.label`);
      if (field.description !== undefined) {
        expectBilingual(field.description, `${field.key}.description`);
      }
      for (const option of field.options ?? []) {
        expectBilingual(option.label, `${field.key}.options.${option.value}`);
      }
    }
  });

  it('offers a reasoning switch, live and per conversation', () => {
    // Whether the model thinks before answering only changes the generation
    // suffix of the next turn — never the frozen prefix — so it is a
    // sampling-family setting: adjustable per conversation, no KV cost.
    const thinking = HARNESS_SETTINGS.find((field) => field.key === 'thinking');
    expect(thinking?.type).toBe('boolean');
    expect(thinking?.scopes).toEqual(['global', 'conversation']);
    expect(thinking?.default).toBe(true);
    expect(KV_INVALIDATING_KEYS.has('thinking')).toBe(false);
  });

  it('keeps its keys unique', () => {
    const keys = HARNESS_SETTINGS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flags the launch parameters that enter the KV manifest', () => {
    for (const key of KV_INVALIDATING_KEYS) {
      const field = HARNESS_SETTINGS.find((candidate) => candidate.key === key);
      expect(field?.scopes, `${key} must be a global (launch) setting`).toEqual(['global']);
    }
  });
});
