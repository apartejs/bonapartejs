/**
 * The `bonaparte` command. Its doctor is the core's: the same search for llama.cpp as a load, the same
 * measure of the card, on the app's own data folder — and it loads nothing.
 */

import { readFileSync } from 'node:fs';
import { bonaparteDataDir, createCore } from '@aparte/bonaparte-core';
import { localeOf, main } from './main.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const code = await main(process.argv.slice(2), {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
  locale: localeOf(process.env),
  version: pkg.version,
  color: process.stdout.isTTY === true,
  doctor: async () => {
    const core = createCore({ dataDir: bonaparteDataDir(), env: process.env, logger: () => undefined });
    try {
      return await core.doctor();
    } finally {
      await core.stop();
    }
  },
});
process.exitCode = code;
