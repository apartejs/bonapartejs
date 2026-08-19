import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Répertoire de données bonaparte : %APPDATA%\bonaparte sur Windows,
 * ~/.bonaparte ailleurs (décision du plan v1).
 */
export function bonaparteDataDir(): string {
  // Échappatoire indispensable aux tests de bout en bout : lancer
  // l'application pour la vérifier ne doit jamais toucher les conversations
  // ni la configuration réelles de l'utilisateur.
  const override = process.env['BONAPARTE_DATA_DIR'];
  if (override) return override;
  if (process.platform === 'win32' && process.env['APPDATA']) {
    return join(process.env['APPDATA'], 'bonaparte');
  }
  return join(homedir(), '.bonaparte');
}

/** Répertoire des états KV (--slot-save-path). */
export function kvSlotsDir(): string {
  return join(bonaparteDataDir(), 'kv-slots');
}
