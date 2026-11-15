/**
 * The vault of the app: each secret encrypted by the system — Electron's
 * safeStorage (DPAPI on Windows, the keychain on a Mac, libsecret on Linux) —
 * and kept, encrypted, in one file of the data folder (`vault.json`). A
 * secret never touches the disk in clear; when the system cannot encrypt,
 * nothing is kept at all (security rule 10).
 */

import { isSecretName, readJsonFile, writeJsonFile, type SecretStore } from '@aparte/bonaparte-core';

/** What the vault needs of Electron's safeStorage: injected, so a test sees through it. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

type Sealed = Record<string, string>;

export function createVault(options: { file: string; safeStorage: SafeStorageLike }): SecretStore {
  const { file, safeStorage } = options;
  const read = async (): Promise<Sealed> => {
    try {
      const sealed = (await readJsonFile(file)) as unknown;
      return typeof sealed === 'object' && sealed !== null ? (sealed as Sealed) : {};
    } catch {
      return {};
    }
  };
  const named = (name: string): void => {
    if (!isSecretName(name)) throw new Error(`Not a secret's name: ${name}`);
  };
  return {
    async get(name) {
      named(name);
      const sealed = (await read())[name];
      return sealed === undefined ? undefined : safeStorage.decryptString(Buffer.from(sealed, 'base64'));
    },
    async set(name, value) {
      named(name);
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('The system cannot encrypt secrets here: none is kept, rather than one in clear.');
      }
      const sealed = await read();
      sealed[name] = safeStorage.encryptString(value).toString('base64');
      await writeJsonFile(file, sealed);
    },
    async delete(name) {
      named(name);
      const sealed = await read();
      if (!(name in sealed)) return;
      delete sealed[name];
      await writeJsonFile(file, sealed);
    },
    async has(name) {
      named(name);
      return name in (await read());
    },
  };
}
