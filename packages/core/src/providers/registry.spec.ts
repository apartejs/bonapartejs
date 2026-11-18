/**
 * The providers (task 9.1): the built-in engine, always there, and the services the person adds. A service is
 * kept in its own file without its key; the key goes to the vault, under the service's id, and never comes back
 * out of the core.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDER, PRESETS, ProviderRegistry } from './registry.js';
import type { SecretStore } from './secrets.js';

function memoryVault(): SecretStore & { held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    delete: async (name) => void held.delete(name),
    has: async (name) => held.has(name),
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bonaparte-providers-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the providers', () => {
  it('the built-in engine is always there, first, and the only one that keeps a memory', async () => {
    const registry = new ProviderRegistry(join(dir, 'providers.json'), memoryVault());
    expect(await registry.list()).toEqual([BUILTIN_PROVIDER]);
    expect(BUILTIN_PROVIDER).toMatchObject({ id: 'builtin', kind: 'builtin', hasKvMemory: true });
  });

  it('a service added: kept without its key, the key in the vault; listed after the built-in engine', async () => {
    const vault = memoryVault();
    const registry = new ProviderRegistry(join(dir, 'providers.json'), vault);
    const added = await registry.add({ kind: 'openai-compat', label: 'Ollama', url: 'http://localhost:11434/v1', server: 'ollama' }, 'sk-secret');
    expect(added).toMatchObject({ kind: 'openai-compat', label: 'Ollama', url: 'http://localhost:11434/v1', hasKvMemory: false });
    expect((await registry.list()).map((provider) => provider.id)).toEqual(['builtin', added.id]);
    expect(await readFile(join(dir, 'providers.json'), 'utf8')).not.toContain('sk-secret');
    expect(await registry.keyOf(added.id)).toBe('sk-secret');
    expect(await registry.hasKey(added.id)).toBe(true);
    // Read again from its file: the same.
    expect(await new ProviderRegistry(join(dir, 'providers.json'), vault).get(added.id)).toEqual(added);
  });

  it('two services of one kind get two ids; removing one takes its key away', async () => {
    const vault = memoryVault();
    const registry = new ProviderRegistry(join(dir, 'providers.json'), vault);
    const first = await registry.add({ kind: 'openai-compat', label: 'LM Studio', url: 'http://localhost:1234/v1' }, 'k1');
    const second = await registry.add({ kind: 'openai-compat', label: 'LM Studio', url: 'http://192.168.1.2:1234/v1' });
    expect(first.id).not.toBe(second.id);
    expect(await registry.hasKey(second.id)).toBe(false);
    await registry.remove(first.id);
    expect(await registry.get(first.id)).toBeUndefined();
    expect(vault.held.size).toBe(0);
  });

  it('a remote llama-server keeps no memory either; the built-in engine cannot be removed', async () => {
    const registry = new ProviderRegistry(join(dir, 'providers.json'), memoryVault());
    const remote = await registry.add({ kind: 'llamacpp-remote', label: 'llama.cpp', url: 'http://localhost:8080' });
    expect(remote.hasKvMemory).toBe(false);
    await expect(registry.remove('builtin')).rejects.toThrow(/built-in/);
  });

  it('the presets: Ollama, LM Studio, a llama.cpp already running, any OpenAI-compatible API', () => {
    expect(PRESETS.map((preset) => [preset.server, preset.url])).toEqual([
      ['llamacpp', 'http://localhost:8080'],
      ['ollama', 'http://localhost:11434/v1'],
      ['lmstudio', 'http://localhost:1234/v1'],
      ['openai', ''],
    ]);
  });
});
