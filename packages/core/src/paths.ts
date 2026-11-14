import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where bonaparte keeps everything: `%APPDATA%\bonaparte` on Windows,
 * `~/.bonaparte` elsewhere. Journals, KV states, snapshots, settings, projects
 * and plugins all live under it.
 *
 * `BONAPARTE_DATA_DIR` moves it. The end-to-end tests depend on that: an app
 * launched to be checked must never touch the person's real conversations.
 */
export function bonaparteDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env['BONAPARTE_DATA_DIR'];
  if (override) return override;
  const appData = env['APPDATA'];
  if (platform === 'win32' && appData) return join(appData, 'bonaparte');
  return join(home, '.bonaparte');
}
