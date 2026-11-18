/**
 * The providers a conversation can run on (task 9.1): the built-in engine — llama.cpp managed by bonaparte, the
 * only one that keeps each conversation's memory — and the services the person adds: a llama-server already
 * running, or a service that speaks OpenAI's API (Ollama, LM Studio, any other). A service is kept in its own
 * file (`config/providers.json`, written by nothing else), without its key: the key goes to the vault under the
 * service's id, and the window is only ever told whether there is one.
 */

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import type { SecretStore } from './secrets.js';

export type ProviderKind = 'builtin' | 'llamacpp-remote' | 'openai-compat';

/** Which server a service is, when known: what aparté's OpenAI-compatible provider adapts to. */
export type ProviderServer = 'llamacpp' | 'ollama' | 'lmstudio' | 'openai';

export interface Provider {
  id: string;
  kind: ProviderKind;
  label: string;
  url?: string;
  server?: ProviderServer;
  /** The conversation's memory kept by the engine (saved, restored): the built-in engine only. */
  hasKvMemory: boolean;
}

export interface NewProvider {
  kind: Exclude<ProviderKind, 'builtin'>;
  label: string;
  url: string;
  server?: ProviderServer;
}

export const BUILTIN_PROVIDER: Provider = { id: 'builtin', kind: 'builtin', label: 'bonaparte', hasKvMemory: true };

/** What the person picks from, an address filled in (« API compatible OpenAI » leaves it to them). */
export const PRESETS: readonly { server: ProviderServer; kind: NewProvider['kind']; label: string; url: string }[] = [
  { server: 'llamacpp', kind: 'llamacpp-remote', label: 'llama.cpp', url: 'http://localhost:8080' },
  { server: 'ollama', kind: 'openai-compat', label: 'Ollama', url: 'http://localhost:11434/v1' },
  { server: 'lmstudio', kind: 'openai-compat', label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { server: 'openai', kind: 'openai-compat', label: 'OpenAI-compatible API', url: '' },
];

const savedSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      kind: z.enum(['llamacpp-remote', 'openai-compat']),
      label: z.string().min(1).max(200),
      url: z.url(),
      server: z.enum(['llamacpp', 'ollama', 'lmstudio', 'openai']).optional(),
    }),
  ),
});

type Saved = z.infer<typeof savedSchema>['providers'][number];

const keyName = (id: string): string => `${id}.key`;

export class ProviderRegistry {
  private readonly queue = new KeyedQueue();

  constructor(
    private readonly file: string,
    private readonly vault: SecretStore,
  ) {}

  async list(): Promise<Provider[]> {
    return [BUILTIN_PROVIDER, ...(await this.read()).map(asProvider)];
  }

  async get(id: string): Promise<Provider | undefined> {
    return (await this.list()).find((provider) => provider.id === id);
  }

  /** Adds a service, its key (when it asks one) to the vault. */
  add(service: NewProvider, key?: string): Promise<Provider> {
    return this.queue.run('file', async () => {
      const saved = await this.read();
      const stem = slug(service.label);
      const id = saved.some((entry) => entry.id === stem) || stem === 'builtin' ? `${stem}-${randomUUID().slice(0, 6)}` : stem;
      const entry: Saved = { id, kind: service.kind, label: service.label, url: service.url, ...(service.server ? { server: service.server } : {}) };
      if (key) await this.vault.set(keyName(id), key);
      await mkdir(dirname(this.file), { recursive: true });
      await writeJsonFile(this.file, { providers: [...saved, entry] });
      return asProvider(entry);
    });
  }

  remove(id: string): Promise<void> {
    if (id === BUILTIN_PROVIDER.id) return Promise.reject(new Error('The built-in engine cannot be removed.'));
    return this.queue.run('file', async () => {
      const saved = await this.read();
      await writeJsonFile(this.file, { providers: saved.filter((entry) => entry.id !== id) });
      await this.vault.delete(keyName(id));
    });
  }

  /** The service's key, for the core's own requests: never handed to the window. */
  keyOf(id: string): Promise<string | undefined> {
    return this.vault.get(keyName(id));
  }

  hasKey(id: string): Promise<boolean> {
    return this.vault.has(keyName(id));
  }

  private async read(): Promise<Saved[]> {
    let raw: unknown;
    try {
      raw = await readJsonFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const parsed = savedSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`The providers file ${this.file} is not valid: ${parsed.error.message}`);
    return parsed.data.providers;
  }
}

function asProvider(entry: Saved): Provider {
  return { ...entry, hasKvMemory: false };
}

function slug(label: string): string {
  const made = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return made || 'service';
}
