/**
 * Builds the llama-server launch arguments from the config. Decisions
 * locked in: explicit -fa on (never auto), mandatory symmetric KV types,
 * --load-mode (mmap/mlock deprecated upstream), extraFlags passthrough
 * last.
 */

export interface LlamaCppLaunchConfig {
  modelPath: string;
  port: number;
  host?: string;
  nCtx?: number;
  nGpuLayers?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  slotSavePath?: string;
  parallelSlots?: number;
  cacheReuse?: number;
  threads?: number;
  loadMode?: string;
  extraFlags?: string[];
}

export function buildLlamaServerArgs(config: LlamaCppLaunchConfig): string[] {
  if (config.cacheTypeK && config.cacheTypeV && config.cacheTypeK !== config.cacheTypeV) {
    throw new Error(
      `KV cache types must be symmetric (K=${config.cacheTypeK}, V=${config.cacheTypeV}): ` +
        'an asymmetric pair silently falls back to a much slower, unfused path.',
    );
  }
  const cacheType = config.cacheTypeK ?? config.cacheTypeV ?? 'f16';

  const args: string[] = [
    '-m', config.modelPath,
    '--host', config.host ?? '127.0.0.1',
    '--port', String(config.port),
    '-fa', 'on',
    '--cache-type-k', cacheType,
    '--cache-type-v', cacheType,
    // Overflow is OUR event (D-22): a silent shift would drop the head of
    // the prompt — and with it the prefix every saved KV state depends on.
    '--no-context-shift',
  ];

  if (config.nCtx !== undefined) args.push('-c', String(config.nCtx));
  if (config.nGpuLayers !== undefined) args.push('-ngl', String(config.nGpuLayers));
  if (config.slotSavePath !== undefined) args.push('--slot-save-path', config.slotSavePath);
  if (config.parallelSlots !== undefined) args.push('--parallel', String(config.parallelSlots));
  if (config.cacheReuse !== undefined) args.push('--cache-reuse', String(config.cacheReuse));
  if (config.threads !== undefined) args.push('--threads', String(config.threads));
  if (config.loadMode !== undefined) args.push('--load-mode', config.loadMode);
  if (config.extraFlags) args.push(...config.extraFlags);

  return args;
}
