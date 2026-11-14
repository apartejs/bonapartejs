/**
 * The environment an end-to-end test gives the app: the machine's own, minus
 * what would take the test out of its box, plus what puts it in.
 */

export interface AppEnvironmentOptions {
  /** A folder of its own: a test never touches the person's conversations. */
  dataDir: string;
  locale: 'fr' | 'en';
  /** What one test adds. It wins over the fixture's values, the test flag excepted. */
  extra?: Record<string, string> | undefined;
}

export function appEnvironment(
  base: Record<string, string | undefined>,
  options: AppEnvironmentOptions,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    // Set by some terminals that are themselves Electron apps: with it, Electron
    // runs the entry as plain Node, and there is no app to drive.
    if (name === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[name] = value;
  }
  return {
    ...env,
    BONAPARTE_DATA_DIR: options.dataDir,
    BONAPARTE_LOCALE: options.locale,
    // The machine's own engine must never leak into a test.
    BONAPARTE_LLAMA_URL: '',
    ...options.extra,
    // Last, so that nothing can turn it off: it is what keeps the window off
    // the person's screen and an error out of a native box.
    BONAPARTE_E2E: '1',
  };
}
