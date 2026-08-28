import { describe, expect, it } from 'vitest';
import { localize, pluginManifestSchema } from './plugins.js';

// Manifest labels are shown to the user (tab titles, the plugins section of
// the settings hub), so they follow the UI rule: every visible string exists
// in both locales. The wire — tool names and descriptions — stays English and
// is not localised.

describe('localized manifest labels', () => {
  it('accepts a label given in both locales', () => {
    const manifest = pluginManifestSchema.parse({
      id: 'demo',
      name: { en: 'Tooled browser', fr: 'Navigateur outillé' },
      version: '0.1.0',
      contributes: {
        toolingViews: [{ id: 'page', title: { en: 'Browser', fr: 'Navigateur' } }],
      },
    });
    expect(manifest.name).toEqual({ en: 'Tooled browser', fr: 'Navigateur outillé' });
    expect(manifest.contributes.toolingViews[0]?.title).toEqual({
      en: 'Browser',
      fr: 'Navigateur',
    });
  });

  it('still accepts a plain string', () => {
    const manifest = pluginManifestSchema.parse({
      id: 'demo',
      name: 'Terminal',
      version: '0.1.0',
    });
    expect(manifest.name).toBe('Terminal');
  });

  it('requires the English form of a localised label', () => {
    expect(() =>
      pluginManifestSchema.parse({ id: 'demo', name: { fr: 'Terminal' }, version: '0.1.0' }),
    ).toThrow();
  });
});

describe('localize', () => {
  it('picks the requested locale', () => {
    expect(localize({ en: 'Browser', fr: 'Navigateur' }, 'fr')).toBe('Navigateur');
  });

  it('falls back to English when the locale is missing', () => {
    expect(localize({ en: 'Browser' }, 'fr')).toBe('Browser');
  });

  it('returns a plain string unchanged', () => {
    expect(localize('Terminal', 'fr')).toBe('Terminal');
  });
});
