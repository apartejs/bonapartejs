/**
 * `createCore` is the one entry to the core. The Electron app builds a core
 * and hands requests to it; a test builds one over a temporary folder.
 *
 * This first version knows a single thing: which llama.cpp server a turn runs
 * on. The server is one that already runs somewhere ("remote"), named in
 * `config/global.json` or by `BONAPARTE_LLAMA_URL`. The engine bonaparte
 * launches and supervises itself arrives with the next phase.
 */

import { join } from 'node:path';
import { z } from 'zod';
import { LlamaCppHttpClient } from './backend/llamacpp/http-client.js';
import { readJsonFile } from './fs/json-file.js';

export interface CoreDeps {
  /** The folder bonaparte keeps everything in (see `bonaparteDataDir`). */
  dataDir: string;
  /** The process environment. A test passes its own, so that the machine's does not leak in. */
  env?: NodeJS.ProcessEnv;
}

export interface Core {
  /** The engine a turn runs on, or undefined when none is configured. */
  engine(): Promise<LlamaCppHttpClient | undefined>;
}

const globalConfigSchema = z.looseObject({
  backend: z.object({ mode: z.literal('remote'), url: z.url() }).optional(),
});

export function createCore(deps: CoreDeps): Core {
  const env = deps.env ?? process.env;

  async function configuredUrl(): Promise<string | undefined> {
    const fromEnv = env['BONAPARTE_LLAMA_URL'];
    if (fromEnv) return fromEnv;
    let raw: unknown;
    try {
      raw = await readJsonFile(join(deps.dataDir, 'config', 'global.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const config = globalConfigSchema.safeParse(raw);
    return config.success ? config.data.backend?.url : undefined;
  }

  return {
    async engine() {
      const url = await configuredUrl();
      return url ? new LlamaCppHttpClient(url.replace(/\/+$/, '')) : undefined;
    },
  };
}
