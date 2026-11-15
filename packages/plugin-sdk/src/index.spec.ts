/**
 * The SDK is what a plugin author imports: the contract the core's host
 * implements, and two helpers that only type what the author writes — they
 * add nothing the host would have to trust.
 */

import { describe, expect, it } from 'vitest';
import { defineManifest, definePlugin, parseManifest, type PluginNodeContext } from './index.js';

describe('the plugin SDK', () => {
  it('definePlugin gives back the module it is given, its activate untouched', async () => {
    const seen: string[] = [];
    const plugin = definePlugin({
      activate(context: PluginNodeContext) {
        seen.push(context.pluginId);
      },
    });
    await plugin.activate({ pluginId: 'notes' } as PluginNodeContext);
    expect(seen).toEqual(['notes']);
  });

  it('a manifest written with defineManifest is one the host reads, and the host still judges it', () => {
    const manifest = defineManifest({
      id: 'notes',
      name: { en: 'Notes', fr: 'Notes' },
      version: '1.0.0',
      effects: [{ effect: 'read', what: 'the project files' }],
      contributes: { tools: [{ name: 'count_notes', description: 'Counts the notes of the project.', effect: 'read' }] },
    });
    expect(parseManifest(manifest)).toMatchObject({ ok: true, manifest: { id: 'notes' } });
    // A tool that does more than its plugin says is refused, whoever wrote the manifest.
    const greedy = defineManifest({ ...manifest, contributes: { tools: [{ ...manifest.contributes!.tools![0]!, effect: 'write' }] } });
    expect(parseManifest(greedy).ok).toBe(false);
  });
});
