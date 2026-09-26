/**
 * The GGUF header says what a model will cost before it is loaded (P2.1):
 * the KV cache per token, from the architecture. Synthetic headers, written
 * here byte by byte in the GGUF v3 layout, cover the families read on real
 * files (2026-09-26): dense, hybrid with a full-attention interval, per-layer
 * KV heads with zeros, sliding windows with their own head sizes.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kvBytesPerToken, kvCacheBytes, readGgufInfo } from './gguf.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

type Value =
  | { u32: number }
  | { str: string }
  | { bool: boolean }
  | { u32s: number[] }
  | { bools: boolean[] }
  | { strs: string[] };

function encode(entries: [string, Value][]): Buffer {
  const parts: Buffer[] = [];
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const str = (s: string): Buffer => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  parts.push(Buffer.from('GGUF'), u32(3), u64(0), u64(entries.length));
  for (const [key, value] of entries) {
    parts.push(str(key));
    if ('u32' in value) parts.push(u32(4), u32(value.u32));
    else if ('str' in value) parts.push(u32(8), str(value.str));
    else if ('bool' in value) parts.push(u32(7), Buffer.from([value.bool ? 1 : 0]));
    else if ('u32s' in value) parts.push(u32(9), u32(4), u64(value.u32s.length), ...value.u32s.map(u32));
    else if ('bools' in value)
      parts.push(u32(9), u32(7), u64(value.bools.length), Buffer.from(value.bools.map((b) => (b ? 1 : 0))));
    else parts.push(u32(9), u32(8), u64(value.strs.length), ...value.strs.map(str));
  }
  return Buffer.concat(parts);
}

async function gguf(entries: [string, Value][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-gguf-'));
  dirs.push(dir);
  const path = join(dir, 'model.gguf');
  await writeFile(path, encode(entries));
  return path;
}

describe('readGgufInfo — the KV cache per token, from the header', () => {
  it('a dense model: every layer caches every token (Qwen3-1.7B: 112 KB/token in f16)', async () => {
    const path = await gguf([
      ['general.architecture', { str: 'qwen3' }],
      ['qwen3.block_count', { u32: 28 }],
      ['qwen3.context_length', { u32: 40960 }],
      ['qwen3.embedding_length', { u32: 2048 }],
      ['qwen3.attention.head_count', { u32: 16 }],
      ['qwen3.attention.head_count_kv', { u32: 8 }],
      ['qwen3.attention.key_length', { u32: 128 }],
      ['qwen3.attention.value_length', { u32: 128 }],
    ]);
    const info = await readGgufInfo(path);

    expect(info).toMatchObject({
      architecture: 'qwen3',
      nLayer: 28,
      fullKvLayers: 28,
      swaKvLayers: 0,
      trainContext: 40960,
    });
    expect(kvBytesPerToken(info, 'f16')).toBe(28 * 8 * 256 * 2); // 114 688 B = 112 KB
    // q8_0 and q4_0 are blocks of 32 elements in 34 and 18 bytes.
    expect(kvBytesPerToken(info, 'q8_0')).toBe(Math.round(28 * 8 * 256 * (34 / 32)));
    expect(kvBytesPerToken(info, 'q4_0')).toBe(Math.round(28 * 8 * 256 * (18 / 32)));
    expect(kvCacheBytes(info, 8192, 'f16')).toBe(28 * 8 * 256 * 2 * 8192);
  });

  it('the head size defaults to embedding / heads when the header does not say', async () => {
    const path = await gguf([
      ['general.architecture', { str: 'llama' }],
      ['llama.block_count', { u32: 16 }],
      ['llama.embedding_length', { u32: 2048 }],
      ['llama.attention.head_count', { u32: 32 }],
      ['llama.attention.head_count_kv', { u32: 8 }],
    ]);
    expect(kvBytesPerToken(await readGgufInfo(path), 'f16')).toBe(16 * 8 * (64 + 64) * 2);
  });

  it('a hybrid model: one layer in full_attention_interval attends (Qwen3.6-35B-A3B: 20 KB/token)', async () => {
    const path = await gguf([
      ['general.architecture', { str: 'qwen35moe' }],
      ['qwen35moe.block_count', { u32: 40 }],
      ['qwen35moe.embedding_length', { u32: 2048 }],
      ['qwen35moe.attention.head_count', { u32: 16 }],
      ['qwen35moe.attention.head_count_kv', { u32: 2 }],
      ['qwen35moe.attention.key_length', { u32: 256 }],
      ['qwen35moe.attention.value_length', { u32: 256 }],
      ['qwen35moe.full_attention_interval', { u32: 4 }],
    ]);
    const info = await readGgufInfo(path);
    expect(info.fullKvLayers).toBe(10);
    expect(kvBytesPerToken(info, 'f16')).toBe(10 * 2 * 512 * 2); // 20 KB
  });

  it('per-layer KV heads: a zero is a layer with no attention (LFM2: 6 of 16 layers)', async () => {
    const kv = [0, 0, 8, 0, 0, 8, 0, 0, 8, 0, 8, 0, 8, 0, 8, 0];
    const path = await gguf([
      ['general.architecture', { str: 'lfm2' }],
      ['lfm2.block_count', { u32: 16 }],
      ['lfm2.embedding_length', { u32: 2048 }],
      ['lfm2.attention.head_count', { u32: 32 }],
      ['lfm2.attention.head_count_kv', { u32s: kv }],
    ]);
    const info = await readGgufInfo(path);
    expect(info.fullKvLayers).toBe(6);
    expect(kvBytesPerToken(info, 'f16')).toBe(6 * 8 * 128 * 2); // 12 KB
  });

  it('sliding-window layers hold at most the window, with their own heads and head sizes (Gemma 4)', async () => {
    // 6 layers: 5 windowed (8 KV heads of 256) then 1 global (2 KV heads of 512).
    const path = await gguf([
      ['general.architecture', { str: 'gemma4' }],
      ['gemma4.block_count', { u32: 6 }],
      ['gemma4.embedding_length', { u32: 2816 }],
      ['gemma4.attention.head_count', { u32: 16 }],
      ['gemma4.attention.head_count_kv', { u32s: [8, 8, 8, 8, 8, 2] }],
      ['gemma4.attention.key_length', { u32: 512 }],
      ['gemma4.attention.value_length', { u32: 512 }],
      ['gemma4.attention.key_length_swa', { u32: 256 }],
      ['gemma4.attention.value_length_swa', { u32: 256 }],
      ['gemma4.attention.sliding_window', { u32: 1024 }],
      ['gemma4.attention.sliding_window_pattern', { bools: [true, true, true, true, true, false] }],
    ]);
    const info = await readGgufInfo(path);
    expect(info).toMatchObject({ fullKvLayers: 1, swaKvLayers: 5, slidingWindow: 1024 });
    expect(kvBytesPerToken(info, 'f16')).toBe(2 * 1024 * 2);
    // 8k context: the global layer holds 8 192 tokens, the windowed ones 1 024.
    expect(kvCacheBytes(info, 8192, 'f16')).toBe((2 * 1024 * 8192 + 5 * 8 * 512 * 1024) * 2);
    // Under the window, every layer holds the whole (short) context.
    expect(kvCacheBytes(info, 512, 'f16')).toBe((2 * 1024 * 512 + 5 * 8 * 512 * 512) * 2);
  });

  it('a large vocabulary before the keys it needs is skipped, not a problem', async () => {
    const vocab = Array.from({ length: 20_000 }, (_, i) => `tok${i}`);
    const path = await gguf([
      ['general.architecture', { str: 'qwen3' }],
      ['tokenizer.ggml.tokens', { strs: vocab }],
      ['qwen3.block_count', { u32: 2 }],
      ['qwen3.embedding_length', { u32: 256 }],
      ['qwen3.attention.head_count', { u32: 4 }],
      ['qwen3.attention.head_count_kv', { u32: 2 }],
    ]);
    expect((await readGgufInfo(path)).fullKvLayers).toBe(2);
  });

  it('a file that is not GGUF, or is cut short, is refused with a reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-gguf-'));
    dirs.push(dir);
    const notGguf = join(dir, 'x.gguf');
    await writeFile(notGguf, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1, 2, 3, 4]));
    await expect(readGgufInfo(notGguf)).rejects.toThrow(/not a gguf/i);

    const whole = encode([
      ['general.architecture', { str: 'qwen3' }],
      ['qwen3.block_count', { u32: 2 }],
    ]);
    const cut = join(dir, 'cut.gguf');
    await writeFile(cut, whole.subarray(0, whole.length - 3));
    await expect(readGgufInfo(cut)).rejects.toThrow(/truncated/i);
  });
});
