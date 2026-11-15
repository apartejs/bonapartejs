/**
 * The environment an end-to-end test gives the app. It is what keeps a test
 * run apart from the person's own bonaparte: its own data folder, no engine of
 * the machine, and the flag that keeps the window off the screen.
 */

import { describe, expect, it } from 'vitest';
import { appEnvironment } from '../../e2e/fixtures/app-env.js';

const options = { dataDir: 'C:/tmp/bonaparte-e2e-1', locale: 'fr' as const };

describe('appEnvironment', () => {
  it('marks the run as a test, in its own data folder and in the language asked', () => {
    expect(appEnvironment({}, options)).toMatchObject({
      BONAPARTE_E2E: '1',
      BONAPARTE_DATA_DIR: 'C:/tmp/bonaparte-e2e-1',
      BONAPARTE_LOCALE: 'fr',
    });
  });

  it("gives the tools a home folder of the test's: they never read or write the person's", () => {
    const env = appEnvironment({ USERPROFILE: 'C:/Users/someone' }, { ...options, home: 'C:/tmp/bonaparte-e2e-1/home' });
    expect(env['BONAPARTE_E2E_HOME']).toBe('C:/tmp/bonaparte-e2e-1/home');
    // Electron itself keeps the machine's: without it, it does not start.
    expect(env['USERPROFILE']).toBe('C:/Users/someone');
  });

  it("never lets the machine's own engine into a test", () => {
    const env = appEnvironment({ BONAPARTE_LLAMA_URL: 'http://127.0.0.1:8080' }, options);
    expect(env['BONAPARTE_LLAMA_URL']).toBe('');
  });

  it('drops ELECTRON_RUN_AS_NODE, which would run Electron as plain Node', () => {
    const env = appEnvironment({ ELECTRON_RUN_AS_NODE: '1', PATH: 'C:/bin' }, options);
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env['PATH']).toBe('C:/bin');
  });

  it('drops ELECTRON_RENDERER_URL: a test drives the built app, never a dev server', () => {
    const env = appEnvironment({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }, options);
    expect(env).not.toHaveProperty('ELECTRON_RENDERER_URL');
  });

  it('leaves out a variable that has no value', () => {
    expect(appEnvironment({ EMPTY: undefined }, options)).not.toHaveProperty('EMPTY');
  });

  it("lets a test add its own variables, which win over the fixture's", () => {
    const env = appEnvironment({}, { ...options, extra: { BONAPARTE_LOCALE: 'en', BONAPARTE_X: 'y' } });
    expect(env).toMatchObject({ BONAPARTE_LOCALE: 'en', BONAPARTE_X: 'y' });
  });

  it('never lets a test turn the test flag off', () => {
    const env = appEnvironment({}, { ...options, extra: { BONAPARTE_E2E: '0' } });
    expect(env['BONAPARTE_E2E']).toBe('1');
  });
});
