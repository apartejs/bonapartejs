/**
 * A plugin's manifest is read and shown before anything of it runs: what it
 * is, what it adds, and what it will be able to do (its effects). A tool can
 * only do what its plugin says it does (security rule 8).
 */

import { describe, expect, it } from 'vitest';
import { localize, parseManifest, pluginManifestSchema, pluginSourceSchema } from './plugins.js';

const base = {
  id: 'changelog',
  name: { en: 'Changelog', fr: 'Journal des versions' },
  version: '0.1.0',
  effects: [{ effect: 'read', what: { en: 'the files of the project', fr: 'les fichiers du projet' } }],
};

describe('the manifest of a plugin', () => {
  it('reads a label in both languages, or a plain string, and asks for the English one', () => {
    expect(pluginManifestSchema.safeParse(base).success).toBe(true);
    expect(pluginManifestSchema.safeParse({ ...base, name: 'Changelog' }).success).toBe(true);
    expect(pluginManifestSchema.safeParse({ ...base, name: { fr: 'Journal' } }).success).toBe(false);
  });

  it('gives every list its empty default', () => {
    const manifest = pluginManifestSchema.parse(base);
    expect(manifest.contributes).toEqual({ tools: [], panes: [], settings: [], commands: [] });
    expect(manifest.entry).toEqual({});
  });

  it('refuses an id that is not a plain name, and a field it does not know', () => {
    expect(pluginManifestSchema.safeParse({ ...base, id: '../escape' }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ ...base, id: 'Changelog' }).success).toBe(false);
    // An unknown key is refused, not dropped: a permission nobody reads is worse than an error.
    expect(pluginManifestSchema.safeParse({ ...base, permissions: ['all'] }).success).toBe(false);
  });

  it('refuses a tool whose effect its plugin does not declare: a plugin cannot say it reads and write', () => {
    const writes = {
      ...base,
      contributes: { tools: [{ name: 'insert_entry', description: 'Insert an entry.', effect: 'write' }] },
    };
    const parsed = parseManifest(writes);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain('insert_entry');
    expect(parsed.ok ? '' : parsed.error).toContain('write');
    const declared = { ...writes, effects: [...base.effects, { effect: 'write', what: 'CHANGELOG.md' }] };
    expect(parseManifest(declared).ok).toBe(true);
  });

  it('has no effect « ui » to declare: what only the window runs is not a plugin tool of the core', () => {
    const ui = { ...base, effects: [{ effect: 'ui', what: 'a pane' }] };
    expect(pluginManifestSchema.safeParse(ui).success).toBe(false);
  });

  it('says why a manifest is refused, with where', () => {
    const parsed = parseManifest({ ...base, version: '' });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain('version');
  });

  it('keeps the default of a setting', () => {
    const manifest = pluginManifestSchema.parse({
      ...base,
      contributes: { settings: [{ key: 'maxEntries', label: 'Entries', type: 'number', default: 20 }] },
    });
    expect(manifest.contributes.settings[0]?.default).toBe(20);
  });
});

describe('what a plugin adds, and where it came from (task 11.1)', () => {
  it('contributes « / » commands: a plain name and what it does', () => {
    const manifest = pluginManifestSchema.parse({ ...base, contributes: { commands: [{ name: 'changelog', description: { en: 'Sum up the commits of the day', fr: 'Résumer les commits du jour' } }] } });
    expect(manifest.contributes.commands).toEqual([{ name: 'changelog', description: { en: 'Sum up the commits of the day', fr: 'Résumer les commits du jour' } }]);
    expect(pluginManifestSchema.safeParse({ ...base, contributes: { commands: [{ name: 'Change Log', description: 'x' }] } }).success).toBe(false);
  });

  it('comes from a folder, npm with its version pinned, git with its commit, or a conversation', () => {
    expect(pluginSourceSchema.parse({ kind: 'folder', path: 'D:/dev/plugins/revue-pr' })).toMatchObject({ kind: 'folder' });
    expect(pluginSourceSchema.parse({ kind: 'npm', name: '@acme/revue-pr', version: '0.3.0' })).toMatchObject({ version: '0.3.0' });
    expect(pluginSourceSchema.parse({ kind: 'git', url: 'https://example.com/revue-pr.git', ref: 'main', commit: 'a'.repeat(40) })).toMatchObject({ ref: 'main' });
    expect(pluginSourceSchema.parse({ kind: 'conversation', conversationId: 'c1', title: 'Une commande /changelog' })).toMatchObject({ kind: 'conversation' });
    expect(pluginSourceSchema.safeParse({ kind: 'npm', name: '@acme/revue-pr' }).success).toBe(false);
  });
});

describe('localize', () => {
  it('picks the language asked, falls back to English, and keeps a plain string', () => {
    expect(localize({ en: 'Changelog', fr: 'Journal' }, 'fr')).toBe('Journal');
    expect(localize({ en: 'Changelog' }, 'fr')).toBe('Changelog');
    expect(localize('Changelog', 'fr')).toBe('Changelog');
  });
});
