/**
 * What an end-to-end test may change in the engine, read from the
 * environment in a test run (`BONAPARTE_E2E=1`) and only then: what to
 * launch instead of llama.cpp (the fake binary), the video memory the card
 * is said to have, the port of the managed server.
 */

import type { CoreDeps } from '@aparte/bonaparte-core';

export function e2eEngineDeps(
  env: Record<string, string | undefined>,
  e2e: boolean,
): Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'port'> {
  if (!e2e) return {};
  const deps: Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'port'> = {};
  try {
    const command = JSON.parse(env['BONAPARTE_E2E_LLAMA_COMMAND'] ?? 'null') as unknown;
    if (Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === 'string')) {
      deps.llamaCommand = command as string[];
    }
  } catch {
    /* not a command: ignored */
  }
  const gpu = Number(env['BONAPARTE_E2E_GPU_BYTES']);
  if (Number.isFinite(gpu) && gpu > 0) deps.gpuMemory = async () => gpu;
  const port = Number(env['BONAPARTE_E2E_ENGINE_PORT']);
  if (Number.isInteger(port) && port > 0 && port < 65536) deps.port = port;
  return deps;
}
