/**
 * What an end-to-end test may change in the engine: what it launches instead
 * of llama.cpp, the video memory it pretends the card has, the port. Read
 * from the environment in a test run, and only then — an app that read them
 * otherwise would run whatever a variable names.
 */

import { describe, expect, it } from 'vitest';
import { e2eEngineDeps, e2ePickedFolder, e2eSearchEngine } from './e2e-engine.js';

describe('e2eEngineDeps', () => {
  const env = {
    BONAPARTE_E2E_LLAMA_COMMAND: JSON.stringify(['C:\\node\\node.exe', 'C:\\repo\\fake-llama-bin.mjs']),
    BONAPARTE_E2E_GPU_BYTES: String(24 * 1024 ** 3),
    BONAPARTE_E2E_ENGINE_PORT: '51234',
  };

  it('reads them in a test run', async () => {
    const deps = e2eEngineDeps(env, true);
    expect(deps.llamaCommand).toEqual(['C:\\node\\node.exe', 'C:\\repo\\fake-llama-bin.mjs']);
    expect(deps.port).toBe(51234);
    expect(await deps.gpuMemory!()).toBe(24 * 1024 ** 3);
  });

  it("never lets a test run ask GitHub: llama.cpp's releases are the test's, or none", () => {
    expect(e2eEngineDeps({ BONAPARTE_E2E_LLAMA_RELEASES: 'http://127.0.0.1:4000/releases' }, true).llamaReleases).toBe(
      'http://127.0.0.1:4000/releases',
    );
    expect(e2eEngineDeps({}, true).llamaReleases).toBeNull();
    expect(e2eEngineDeps({ BONAPARTE_E2E_LLAMA_RELEASES: 'https://example.com/releases' }, true).llamaReleases).toBeNull();
  });

  it('never lets a test run ask Hugging Face: the models come from the hub of the test, or none', () => {
    expect(e2eEngineDeps({ BONAPARTE_E2E_MODEL_HUB: 'http://127.0.0.1:4001' }, true).modelHub).toBe('http://127.0.0.1:4001');
    expect(e2eEngineDeps({}, true).modelHub).toBeNull();
    expect(e2eEngineDeps({ BONAPARTE_E2E_MODEL_HUB: 'https://huggingface.co' }, true).modelHub).toBeNull();
  });

  it("recommends the test's catalogue when it gives one, read entry by entry", () => {
    const entry = { id: 'small', family: 'gemma', name: 'Small', repo: 'google/small', file: 'small.gguf', bytes: 10, sha256: 'a'.repeat(64), context: 8192, fromGiB: 0 };
    const hub = { BONAPARTE_E2E_MODEL_HUB: 'http://127.0.0.1:4001' };
    expect(e2eEngineDeps({ ...hub, BONAPARTE_E2E_MODEL_CATALOGUE: JSON.stringify([entry, { id: 'broken' }]) }, true).modelCatalogue).toEqual([entry]);
    expect(e2eEngineDeps({ ...hub, BONAPARTE_E2E_MODEL_CATALOGUE: 'nope' }, true).modelCatalogue).toEqual([]);
    // No hub of the test: nothing recommended — no button may point at Hugging Face.
    expect(e2eEngineDeps({ BONAPARTE_E2E_MODEL_CATALOGUE: JSON.stringify([entry]) }, true).modelCatalogue).toEqual([]);
  });

  it("gives the tools the test's home folder — an absolute path, in a test run only", () => {
    expect(e2eEngineDeps({ BONAPARTE_E2E_HOME: 'C:\\tmp\\e2e\\home' }, true).home).toBe('C:\\tmp\\e2e\\home');
    expect(e2eEngineDeps({ BONAPARTE_E2E_HOME: 'relative/home' }, true).home).toBeUndefined();
    expect(e2eEngineDeps({ BONAPARTE_E2E_HOME: 'C:\\tmp\\e2e\\home' }, false).home).toBeUndefined();
  });

  it('ignores them outside a test run', () => {
    expect(e2eEngineDeps(env, false)).toEqual({});
  });

  it('ignores what it cannot read', () => {
    expect(
      e2eEngineDeps({ BONAPARTE_E2E_LLAMA_COMMAND: 'node fake.mjs', BONAPARTE_E2E_ENGINE_PORT: 'eighty' }, true),
    ).toEqual({ gh: null, llamaReleases: null, modelHub: null, modelCatalogue: [], resourceProbes: expect.any(Object) });
    expect(e2eEngineDeps({ BONAPARTE_E2E_LLAMA_COMMAND: JSON.stringify([]) }, true)).toEqual({ gh: null, llamaReleases: null, modelHub: null, modelCatalogue: [], resourceProbes: expect.any(Object) });
  });
});

describe('the readings of a test run (task 12.4)', () => {
  it('are the figures the test gives, never the card's PowerShell probe', async () => {
    const deps = e2eEngineDeps({ BONAPARTE_E2E_RESOURCES: JSON.stringify({ cpu: 12, usedBytes: 8, totalBytes: 16 }) }, true);
    expect(await deps.resourceProbes!.system()).toEqual({ cpu: 12, memory: { usedBytes: 8, totalBytes: 16 } });
    expect(await deps.resourceProbes!.gpu!()).toBeNull();
    expect(e2eEngineDeps({}, false).resourceProbes).toBeUndefined();
  });
});

describe('e2ePickedFolder', () => {
  it("is the test's folder in a test run — never the system's dialog, which would put a window on the screen", () => {
    expect(e2ePickedFolder({ BONAPARTE_E2E_PICK_FOLDER: 'C:\\tmp\\e2e\\spanwise' }, true)).toBe('C:\\tmp\\e2e\\spanwise');
    // A test run that names none closes the dialog: nothing chosen, nothing shown.
    expect(e2ePickedFolder({}, true)).toBeNull();
    expect(e2ePickedFolder({ BONAPARTE_E2E_PICK_FOLDER: 'relative' }, true)).toBeNull();
  });

  it('is nothing outside a test run: the system asks the person', () => {
    expect(e2ePickedFolder({ BONAPARTE_E2E_PICK_FOLDER: 'C:\\tmp\\x' }, false)).toBeUndefined();
  });
});


describe('GitHub in a test run', () => {
  it('is the test’s fake CLI, or none: a test run never asks GitHub', () => {
    expect(e2eEngineDeps({}, true).gh).toBeNull();
    expect(e2eEngineDeps({ BONAPARTE_E2E_GH_COMMAND: JSON.stringify(['node', 'fake-gh.mjs']) }, true).gh).toEqual(['node', 'fake-gh.mjs']);
    expect(e2eEngineDeps({ BONAPARTE_E2E_GH_COMMAND: '{"not": "a command"}' }, true).gh).toBeNull();
    expect(e2eEngineDeps({ BONAPARTE_E2E_GH_COMMAND: JSON.stringify(['node']) }, false).gh).toBeUndefined();
  });
});

describe('e2eSearchEngine (task 10.4)', () => {
  it('outside a test run, the public engine; in a test run, only a local engine of the test — never the internet', () => {
    expect(e2eSearchEngine({}, false)).toBeUndefined();
    expect(e2eSearchEngine({}, true)).toBeNull();
    expect(e2eSearchEngine({ BONAPARTE_E2E_SEARCH_ENGINE: 'http://127.0.0.1:4100/html/?q=' }, true)).toBe('http://127.0.0.1:4100/html/?q=');
    expect(e2eSearchEngine({ BONAPARTE_E2E_SEARCH_ENGINE: 'https://html.duckduckgo.com/html/?q=' }, true)).toBeNull();
    expect(e2eSearchEngine({ BONAPARTE_E2E_SEARCH_ENGINE: 'http://127.0.0.1:4100/html/?q=' }, false)).toBeUndefined();
  });
});
