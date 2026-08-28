import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * bonaparte data directory: %APPDATA%\bonaparte on Windows, ~/.bonaparte
 * elsewhere (v1 plan decision).
 */
export function bonaparteDataDir(): string {
  // Escape hatch indispensable for end-to-end tests: launching the
  // application to verify it must never touch the user's real
  // conversations or configuration.
  const override = process.env['BONAPARTE_DATA_DIR'];
  if (override) return override;
  if (process.platform === 'win32' && process.env['APPDATA']) {
    return join(process.env['APPDATA'], 'bonaparte');
  }
  return join(homedir(), '.bonaparte');
}

/** Directory for KV states (--slot-save-path). */
export function kvSlotsDir(): string {
  return join(bonaparteDataDir(), 'kv-slots');
}
