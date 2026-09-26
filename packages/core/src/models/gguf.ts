/**
 * GGUF header reader (P2.1, D-21) — what a model will cost before it is
 * loaded. The weights are the file; the context is the KV cache, and its
 * size per token comes from the architecture written in the header:
 *
 *   2 (K and V) × layers that cache every token × KV heads × head size × bytes
 *
 * — about 96 KB per token on a 30B-class model in f16, an order of
 * magnitude above the "8 KB/token" of a small one, and a hybrid model far
 * below (measured on real headers, 2026-09-26: Qwen3-1.7B 112 KB/token —
 * the smoke's slot file says 114.7 —, granite-4.2-8B 160, Qwen3.6-35B-A3B
 * 20, its linear-attention layers keeping a fixed state). Layers that do
 * not keep a per-token cache are counted apart: recurrent layers (nothing
 * per token) and sliding-window layers (at most the window), each layer
 * with its own KV heads and head sizes — Gemma's global layers have fewer
 * heads, twice as wide, than its windowed ones.
 *
 * Only the header is read — a few MB even with a large vocabulary — with
 * buffered positional reads; the tensors are never touched.
 */

import { open, type FileHandle } from 'node:fs/promises';

/** What the header says about the cost of a model. */
export interface GgufInfo {
  architecture: string;
  /** Transformer blocks. */
  nLayer: number;
  /** Layers keeping a K/V entry for every token of the context. */
  fullKvLayers: number;
  /** Layers keeping at most `slidingWindow` tokens (0 when none). */
  swaKvLayers: number;
  slidingWindow: number;
  /** Elements one token adds across the full-context layers, K and V together: Σ KV heads × (key + value size). */
  fullKvElementsPerToken: number;
  /** The same across the sliding-window layers (they hold at most the window). */
  swaKvElementsPerToken: number;
  /** Context the model was trained for, when the header says. */
  trainContext?: number;
  /** Tensors in the file (a sanity number). */
  tensorCount: number;
}

export type KvCacheTypeName = 'f16' | 'q8_0' | 'q4_0';

/** Bytes per element of the KV cache types llama.cpp offers (blocks of 32: q8_0 = 34 bytes, q4_0 = 18). */
const BYTES_PER_ELEMENT: Record<KvCacheTypeName, number> = {
  f16: 2,
  q8_0: 34 / 32,
  q4_0: 18 / 32,
};

/** KV bytes a context of `nCtx` tokens takes with this cache type. */
export function kvCacheBytes(info: GgufInfo, nCtx: number, cacheType: KvCacheTypeName): number {
  const bytes = BYTES_PER_ELEMENT[cacheType];
  const full = info.fullKvElementsPerToken * nCtx;
  const swa = info.swaKvElementsPerToken * Math.min(nCtx, info.slidingWindow || nCtx);
  return Math.round((full + swa) * bytes);
}

/** KV bytes one more token adds, once the sliding windows are full (the marginal cost). */
export function kvBytesPerToken(info: GgufInfo, cacheType: KvCacheTypeName): number {
  return Math.round(info.fullKvElementsPerToken * BYTES_PER_ELEMENT[cacheType]);
}

// ── Reading ─────────────────────────────────────────────────────────────

/** The value types a GGUF key can hold (gguf.md, "gguf_metadata_value_type"). */
const ValueType = {
  U8: 0,
  I8: 1,
  U16: 2,
  I16: 3,
  U32: 4,
  I32: 5,
  F32: 6,
  Bool: 7,
  String: 8,
  Array: 9,
  U64: 10,
  I64: 11,
  F64: 12,
} as const;
type ValueType = (typeof ValueType)[keyof typeof ValueType];

const SCALAR_SIZE: Partial<Record<number, number>> = {
  [ValueType.U8]: 1,
  [ValueType.I8]: 1,
  [ValueType.U16]: 2,
  [ValueType.I16]: 2,
  [ValueType.U32]: 4,
  [ValueType.I32]: 4,
  [ValueType.F32]: 4,
  [ValueType.Bool]: 1,
  [ValueType.U64]: 8,
  [ValueType.I64]: 8,
  [ValueType.F64]: 8,
};

/** More than any real header holds: a length past this is a corrupt file, not a vocabulary. */
const MAX_COUNT = 50_000_000;

class Reader {
  private buffer = Buffer.alloc(0);
  private bufferStart = 0;
  position = 0;

  constructor(private readonly file: FileHandle) {}

  private async ensure(bytes: number): Promise<void> {
    const end = this.position + bytes;
    if (this.position >= this.bufferStart && end <= this.bufferStart + this.buffer.length) return;
    const size = Math.max(bytes, 1 << 20);
    const chunk = Buffer.alloc(size);
    const { bytesRead } = await this.file.read(chunk, 0, size, this.position);
    if (bytesRead < bytes) throw new Error('GGUF header truncated');
    this.buffer = chunk.subarray(0, bytesRead);
    this.bufferStart = this.position;
  }

  private async take(bytes: number): Promise<Buffer> {
    await this.ensure(bytes);
    const offset = this.position - this.bufferStart;
    this.position += bytes;
    return this.buffer.subarray(offset, offset + bytes);
  }

  async u32(): Promise<number> {
    return (await this.take(4)).readUInt32LE(0);
  }

  async u64(): Promise<number> {
    const value = (await this.take(8)).readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF value out of range');
    return Number(value);
  }

  async string(): Promise<string> {
    const length = await this.u64();
    if (length > MAX_COUNT) throw new Error('GGUF string length out of range');
    return (await this.take(length)).toString('utf8');
  }

  async scalar(type: ValueType): Promise<number | boolean> {
    const bytes = await this.take(SCALAR_SIZE[type] ?? 0);
    switch (type) {
      case ValueType.U8:
        return bytes.readUInt8(0);
      case ValueType.I8:
        return bytes.readInt8(0);
      case ValueType.U16:
        return bytes.readUInt16LE(0);
      case ValueType.I16:
        return bytes.readInt16LE(0);
      case ValueType.U32:
        return bytes.readUInt32LE(0);
      case ValueType.I32:
        return bytes.readInt32LE(0);
      case ValueType.F32:
        return bytes.readFloatLE(0);
      case ValueType.Bool:
        return bytes.readUInt8(0) !== 0;
      case ValueType.U64:
        return Number(bytes.readBigUInt64LE(0));
      case ValueType.I64:
        return Number(bytes.readBigInt64LE(0));
      case ValueType.F64:
        return bytes.readDoubleLE(0);
      default:
        throw new Error(`GGUF: not a scalar type (${type})`);
    }
  }

  /** Reads a value; arrays of numbers are kept (per-layer counts), arrays of strings skipped. */
  async value(type: ValueType): Promise<unknown> {
    if (type === ValueType.String) return this.string();
    if (type === ValueType.Array) {
      const itemType = (await this.u32()) as ValueType;
      const count = await this.u64();
      if (count > MAX_COUNT) throw new Error('GGUF array length out of range');
      if (itemType === ValueType.String || itemType === ValueType.Array) {
        for (let i = 0; i < count; i++) await this.value(itemType);
        return undefined; // a vocabulary: not needed, not kept
      }
      const size = SCALAR_SIZE[itemType];
      if (size === undefined) throw new Error(`GGUF: unknown array item type ${itemType}`);
      if (count > 4096) {
        await this.take(count * size); // token scores and the like: skipped
        return undefined;
      }
      const items: (number | boolean)[] = [];
      for (let i = 0; i < count; i++) items.push(await this.scalar(itemType));
      return items;
    }
    if (SCALAR_SIZE[type] === undefined) throw new Error(`GGUF: unknown value type ${type}`);
    return this.scalar(type);
  }
}

/** Reads the metadata key/values of a GGUF file (tensors untouched). */
export async function readGgufMetadata(path: string): Promise<{ tensorCount: number; metadata: Map<string, unknown> }> {
  const file = await open(path, 'r');
  try {
    const reader = new Reader(file);
    const magic = (await reader.u32()) >>> 0;
    if (magic !== 0x46554747) throw new Error(`Not a GGUF file: ${path}`); // "GGUF", little-endian
    const version = await reader.u32();
    if (version < 2 || version > 3) throw new Error(`GGUF version ${version} is not supported`);
    const tensorCount = await reader.u64();
    const kvCount = await reader.u64();
    if (kvCount > 100_000) throw new Error('GGUF key count out of range');
    const metadata = new Map<string, unknown>();
    for (let i = 0; i < kvCount; i++) {
      const key = await reader.string();
      const type = (await reader.u32()) as ValueType;
      metadata.set(key, await reader.value(type));
    }
    return { tensorCount, metadata };
  } finally {
    await file.close();
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Per-layer values: a number applies to every layer, an array names each. */
function perLayer(value: unknown, nLayer: number): number[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => (typeof item === 'number' ? item : 0));
    return items.length >= nLayer ? items.slice(0, nLayer) : undefined;
  }
  const single = num(value);
  return single === undefined ? undefined : Array.from({ length: nLayer }, () => single);
}

/** What the header says about the cost of a model — see the module comment. */
export async function readGgufInfo(path: string): Promise<GgufInfo> {
  const { tensorCount, metadata } = await readGgufMetadata(path);
  const arch = metadata.get('general.architecture');
  if (typeof arch !== 'string' || arch === '') throw new Error(`GGUF without an architecture: ${path}`);
  const key = (name: string): unknown => metadata.get(`${arch}.${name}`);

  const nLayer = num(key('block_count'));
  if (nLayer === undefined || nLayer <= 0) throw new Error(`GGUF without a block count: ${path}`);
  const embedding = num(key('embedding_length')) ?? 0;
  const heads = perLayer(key('attention.head_count'), nLayer) ?? [];
  const kvHeads = perLayer(key('attention.head_count_kv'), nLayer) ?? heads;
  const headsForDim = heads.find((count) => count > 0) ?? 0;
  const defaultDim = headsForDim > 0 ? embedding / headsForDim : 0;
  const keyLength = num(key('attention.key_length')) ?? defaultDim;
  const valueLength = num(key('attention.value_length')) ?? defaultDim;
  const keyLengthSwa = num(key('attention.key_length_swa')) ?? keyLength;
  const valueLengthSwa = num(key('attention.value_length_swa')) ?? valueLength;

  // Hybrid models: only one layer in `full_attention_interval` attends
  // (Qwen3-Next and its successors); the others keep a fixed state.
  const interval = num(key('full_attention_interval'));
  const attends = (layer: number): boolean =>
    (kvHeads[layer] ?? 0) > 0 && (interval === undefined || interval <= 1 || (layer + 1) % interval === 0);

  // Sliding-window layers: a boolean per layer, or a pattern where every
  // N-th layer is global (the Gemma family).
  const window = num(key('attention.sliding_window')) ?? 0;
  const pattern = key('attention.sliding_window_pattern');
  const isSwa = (layer: number): boolean => {
    if (window <= 0) return false;
    if (Array.isArray(pattern)) return pattern[layer] === true;
    const every = num(pattern);
    return every !== undefined && every > 1 ? (layer + 1) % every !== 0 : false;
  };

  let fullKvLayers = 0;
  let swaKvLayers = 0;
  let fullElements = 0;
  let swaElements = 0;
  for (let layer = 0; layer < nLayer; layer++) {
    if (!attends(layer)) continue;
    const heads = kvHeads[layer] ?? 0;
    if (isSwa(layer)) {
      swaKvLayers += 1;
      swaElements += heads * (keyLengthSwa + valueLengthSwa);
    } else {
      fullKvLayers += 1;
      fullElements += heads * (keyLength + valueLength);
    }
  }

  const trainContext = num(key('context_length'));
  return {
    architecture: arch,
    nLayer,
    fullKvLayers,
    swaKvLayers,
    slidingWindow: window,
    fullKvElementsPerToken: fullElements,
    swaKvElementsPerToken: swaElements,
    ...(trainContext !== undefined ? { trainContext } : {}),
    tensorCount,
  };
}
