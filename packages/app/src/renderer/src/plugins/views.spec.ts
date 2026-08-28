import { describe, expect, it } from 'vitest';
import { loadPluginView, pluginsWithViews } from './views.js';

/**
 * `views.ts`'s glob has a SILENT failure mode: if it targets the wrong
 * folder, it picks up nothing, throws nothing, and every plugin tab displays
 * "this view could not be loaded" at runtime. This is exactly what happened
 * throughout all of J3 — a missing `../`.
 *
 * So we compare the bundle against the MANIFESTS, which are the source of
 * truth: every plugin declaring `entry.renderer` must see its view resolved
 * here. The "at least one view" test anchors the base path — without it, two
 * equally wrong globs would compare empty to empty and pass.
 */

interface Manifest {
  id: string;
  entry?: { renderer?: string };
}

const manifests = import.meta.glob('../../../../../../plugins/*/plugin.json', {
  eager: true,
  import: 'default',
}) as Record<string, Manifest>;

function pluginsDeclaringAView(): string[] {
  return Object.values(manifests)
    .filter((manifest) => manifest.entry?.renderer)
    .map((manifest) => manifest.id)
    .sort();
}

describe('resolution of plugin views', () => {
  it('picks up at least one view (the glob isn’t targeting a void)', () => {
    expect(pluginsWithViews().length).toBeGreaterThan(0);
  });

  it('picks up exactly the plugins whose manifest declares a view', () => {
    expect(pluginsWithViews().sort()).toEqual(pluginsDeclaringAView());
  });

  it('actually loads the component for each view', async () => {
    for (const id of pluginsWithViews()) {
      const view = await loadPluginView(id);
      expect(view, `the view of plugin ${id} could not be loaded`).toBeTypeOf(
        'function',
      );
    }
  });

  it('returns null for a plugin without a view, without throwing', async () => {
    await expect(loadPluginView('plugin-qui-nexiste-pas')).resolves.toBeNull();
  });
});
