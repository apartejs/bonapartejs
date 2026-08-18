/**
 * Construction des arguments de lancement de llama-server à partir de la
 * config. Décisions actées : -fa on explicite (jamais auto), types KV
 * symétriques obligatoires, --load-mode (mmap/mlock dépréciés upstream),
 * extraFlags passthrough en dernier.
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
      `Les types de cache KV doivent être symétriques (K=${config.cacheTypeK}, V=${config.cacheTypeV}) : ` +
        'un couple asymétrique retombe silencieusement sur un chemin non fusionné bien plus lent.',
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
