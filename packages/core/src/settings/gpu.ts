/**
 * Whether the interface asks for the GPU (P3.1, D-23).
 *
 * Chromium fixes its GPU mode when the process starts, for the whole app —
 * never per view — so this is read once, before the app is ready, from the
 * saved config. Off by default: the interface is text, lists and diffs, and
 * every megabyte of VRAM it leaves is context for the model. `auto` keeps
 * the GPU for the one plugin that renders real pages, the browser, while it
 * is on.
 */

/** The plugin whose pages are worth the GPU. */
const GPU_PLUGIN = 'browser';

export type GpuAccelerationChoice = 'off' | 'auto' | 'on';

export function wantsGpuAcceleration(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const { settings, disabledPlugins } = config as { settings?: unknown; disabledPlugins?: unknown };
  const choice =
    typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>)['gpuAcceleration']
      : undefined;
  if (choice === 'on') return true;
  if (choice !== 'auto') return false;
  return !(Array.isArray(disabledPlugins) && disabledPlugins.includes(GPU_PLUGIN));
}
