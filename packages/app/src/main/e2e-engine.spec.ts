/**
 * What an end-to-end test may change in the engine: what it launches instead
 * of llama.cpp, the video memory it pretends the card has, the port. Read
 * from the environment in a test run, and only then — an app that read them
 * otherwise would run whatever a variable names.
 */

import { describe, expect, it } from 'vitest';
import { e2eEngineDeps, e2ePickedFolder } from './e2e-engine.js';

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
    ).toEqual({ llamaReleases: null });
    expect(e2eEngineDeps({ BONAPARTE_E2E_LLAMA_COMMAND: JSON.stringify([]) }, true)).toEqual({ llamaReleases: null });
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

