import type { ComponentType } from 'react';
import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';

/**
 * Resolution of plugin views.
 *
 * Bundled plugins live in `plugins/<id>/` at the root of the repo, along
 * with their manifest. Their renderer entry point is picked up here by
 * `import.meta.glob`: Vite turns them into SEPARATE chunks, loaded only when
 * the view is displayed. The manifest remains the source of truth (it's the
 * one that declares the tabs); this only supplies the component.
 *
 * Accepted and documented limitation: a THIRD-PARTY plugin, outside the
 * tree, is not picked up by this glob. Loading it will require a custom
 * Electron protocol and an import map sharing React — the extension point is
 * identified, it is not opened in v1 (see the plan, "double React" risk).
 */
// SIX levels: this file is in packages/app/src/renderer/src/plugins/, and
// `plugins/` is at the ROOT of the repo. At five, we'd target
// `packages/plugins/`, which doesn't exist — the glob then picks up nothing,
// silently, and every view displays "could not be loaded".
const modules = import.meta.glob('../../../../../../plugins/*/renderer.tsx');

export type ToolingViewComponent = ComponentType<ToolingViewProps>;

/** Loads a plugin's view component, or null if it doesn't provide one. */
export async function loadPluginView(
  pluginId: string,
): Promise<ToolingViewComponent | null> {
  const entry = Object.entries(modules).find(([path]) =>
    path.includes(`/plugins/${pluginId}/`),
  );
  if (!entry) return null;
  const loaded = (await entry[1]()) as { default?: ToolingViewComponent };
  return loaded.default ?? null;
}

/** Ids of the plugins whose view is actually available in this bundle. */
export function pluginsWithViews(): string[] {
  return Object.keys(modules)
    .map((path) => /\/plugins\/([^/]+)\//.exec(path)?.[1])
    .filter((id): id is string => Boolean(id));
}
