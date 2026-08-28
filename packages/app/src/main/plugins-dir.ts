import { join } from 'node:path';

export interface PluginsDirInput {
  env: Record<string, string | undefined>;
  /** `app.getAppPath()` — the directory Electron was pointed at. */
  appPath: string;
  /** `process.resourcesPath` — meaningful only when packaged. */
  resourcesPath: string;
  isPackaged: boolean;
  exists: (path: string) => boolean;
}

/**
 * Where the built-in plugins live, for the three ways the app can run.
 *
 * - `BONAPARTE_PLUGINS_DIR` wins: tests and experiments point it wherever
 *   they want.
 * - A packaged app (installer, later) carries them in its resources.
 * - `npx @aparte/bonaparte` runs an app directory assembled inside the CLI
 *   package, with the plugins shipped under it.
 * - In the monorepo, `packages/app` sits two levels below the root `plugins/`.
 */
export function resolvePluginsDir(input: PluginsDirInput): string {
  const override = input.env['BONAPARTE_PLUGINS_DIR'];
  if (override) return override;
  if (input.isPackaged) return join(input.resourcesPath, 'plugins');
  const shipped = join(input.appPath, 'plugins');
  if (input.exists(shipped)) return shipped;
  return join(input.appPath, '..', '..', 'plugins');
}
