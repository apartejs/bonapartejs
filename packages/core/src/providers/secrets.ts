/**
 * The vault: where an API key or a token lives — the system's own (on
 * Windows, DPAPI through Electron's safeStorage), never a settings file
 * (security rule 10). The core reads a secret through this when it calls a
 * provider; the window never sees one in clear.
 */

export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  has(name: string): Promise<boolean>;
}

/** A secret's name: a provider's id and what it holds, never a path. */
export function isSecretName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name);
}
