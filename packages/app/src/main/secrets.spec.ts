/**
 * The vault of the app: secrets encrypted by the system (safeStorage: DPAPI
 * on Windows, the keychain on a Mac, libsecret on Linux), kept in one file of
 * the data folder that never holds a secret in clear — and nothing kept at
 * all when the system cannot encrypt (security rule 10).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVault, type SafeStorageLike } from './secrets.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

/** An encryption a test can see through: the bytes reversed. */
function fakeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from([...Buffer.from(text, 'utf8')].reverse()),
    decryptString: (data) => Buffer.from([...data].reverse()).toString('utf8'),
  };
}

async function vaultFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-vault-'));
  dirs.push(dir);
  return join(dir, 'vault.json');
}

describe('the vault', () => {
  it('keeps a secret encrypted: read back as it was, never in clear on disk', async () => {
    const file = await vaultFile();
    const vault = createVault({ file, safeStorage: fakeStorage() });
    await vault.set('openai.apiKey', 'sk-live-0123456789');
    expect(await vault.get('openai.apiKey')).toBe('sk-live-0123456789');
    expect(await vault.has('openai.apiKey')).toBe(true);
    expect(await readFile(file, 'utf8')).not.toContain('sk-live-0123456789');
    // Another vault on the same file: the secret survives a restart.
    expect(await createVault({ file, safeStorage: fakeStorage() }).get('openai.apiKey')).toBe('sk-live-0123456789');
  });

  it('forgets a secret when asked; an unknown one is nothing', async () => {
    const vault = createVault({ file: await vaultFile(), safeStorage: fakeStorage() });
    await vault.set('a', 'x');
    await vault.delete('a');
    expect(await vault.get('a')).toBeUndefined();
    expect(await vault.has('a')).toBe(false);
    expect(await vault.get('never')).toBeUndefined();
  });

  it('keeps nothing when the system cannot encrypt: never a secret in clear', async () => {
    const file = await vaultFile();
    const vault = createVault({ file, safeStorage: fakeStorage(false) });
    await expect(vault.set('a', 'x')).rejects.toThrow(/encrypt/);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('refuses a name that is not one: a secret is named, never placed by a path', async () => {
    const vault = createVault({ file: await vaultFile(), safeStorage: fakeStorage() });
    await expect(vault.set('../x', 'y')).rejects.toThrow();
  });
});
