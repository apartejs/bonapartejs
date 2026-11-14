/**
 * The arguments llama-server is launched with. Decisions locked in: explicit
 * `-fa on` (never auto), symmetric K/V cache types, one slot unless told
 * otherwise, every layer on the graphics card unless told otherwise, this
 * machine only, no context shift, no web UI. The per-launch key never travels
 * here: it is in the child's environment (`LLAMA_API_KEY`), because any
 * process can read another's command line.
 */

export interface LlamaCppLaunchConfig {
  modelPath: string;
  port: number;
  /** The context of the server, shared by its slots. Absent: the model's own. */
  nCtx?: number;
  /** Absent: one. Each slot is a whole context more in video memory. */
  slots?: number;
  /** Absent or 'all': every layer. A number: that many, the rest on the processor. */
  gpuLayers?: number | 'all';
  cacheTypeK?: string;
  cacheTypeV?: string;
  slotSavePath?: string;
}

/**
 * More layers than any model has: the server keeps what exists. A number
 * rather than `all`, which older builds do not know.
 */
const ALL_LAYERS = 999;

export function buildLlamaServerArgs(config: LlamaCppLaunchConfig): string[] {
  if (config.cacheTypeK && config.cacheTypeV && config.cacheTypeK !== config.cacheTypeV) {
    throw new Error(
      `KV cache types must be symmetric (K=${config.cacheTypeK}, V=${config.cacheTypeV}): ` +
        'an asymmetric pair silently falls back to a much slower, unfused path.',
    );
  }
  const layers = config.gpuLayers ?? 'all';
  if (layers !== 'all' && !(Number.isInteger(layers) && layers >= 0)) {
    throw new Error(`The number of GPU layers must be a whole number, 0 or more: ${layers}`);
  }
  const cacheType = config.cacheTypeK ?? config.cacheTypeV ?? 'f16';

  const args: string[] = [
    '-m', config.modelPath,
    '--host', '127.0.0.1',
    '--port', String(config.port),
    // The server's own default is "auto", which sizes the slots itself: the
    // context each one gets would not be the one we announced.
    '-np', String(config.slots ?? 1),
    // The server's own default is "auto", which may leave layers on the
    // processor without saying so: a much slower model, unannounced.
    '-ngl', String(layers === 'all' ? ALL_LAYERS : layers),
    '-fa', 'on',
    '--cache-type-k', cacheType,
    '--cache-type-v', cacheType,
    // Overflow is OUR event: a silent shift would drop the head of the
    // prompt, and with it the prefix every saved KV state depends on.
    '--no-context-shift',
    // Nobody browses to our server: the web UI is surface for nothing.
    '--no-webui',
  ];

  if (config.nCtx !== undefined) args.push('-c', String(config.nCtx));
  if (config.slotSavePath !== undefined) args.push('--slot-save-path', config.slotSavePath);

  return args;
}
