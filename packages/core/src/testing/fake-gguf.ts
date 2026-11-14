/**
 * A GGUF file for the tests: a real v3 header — architecture, blocks, heads,
 * the context it was trained for, a chat template — and padding to give it a
 * size. Enough for the inventory, the cost and the family to read it; no
 * weights.
 */

import { writeFile } from 'node:fs/promises';
import { FAKE_GEMMA_TEMPLATE } from './fake-llama-server.js';

export interface FakeGgufOptions {
  architecture?: string;
  blockCount?: number;
  embeddingLength?: number;
  headCount?: number;
  headCountKv?: number;
  contextLength?: number;
  /** Absent: the Gemma 4 one. `null`: a header without a template. */
  chatTemplate?: string | null;
  /** Bytes after the header, so that the file has the size of a model to announce. */
  paddingBytes?: number;
}

const u32 = (n: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(n);
  return buffer;
};
const u64 = (n: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(n));
  return buffer;
};
const str = (s: string): Buffer => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
const STRING = 8;
const UINT32 = 4;

export async function writeFakeGguf(path: string, options: FakeGgufOptions = {}): Promise<void> {
  const arch = options.architecture ?? 'gemma4';
  const entries: Buffer[] = [
    Buffer.concat([str('general.architecture'), u32(STRING), str(arch)]),
    Buffer.concat([str(`${arch}.block_count`), u32(UINT32), u32(options.blockCount ?? 26)]),
    Buffer.concat([str(`${arch}.embedding_length`), u32(UINT32), u32(options.embeddingLength ?? 1024)]),
    Buffer.concat([str(`${arch}.attention.head_count`), u32(UINT32), u32(options.headCount ?? 8)]),
    Buffer.concat([str(`${arch}.attention.head_count_kv`), u32(UINT32), u32(options.headCountKv ?? 4)]),
    Buffer.concat([str(`${arch}.context_length`), u32(UINT32), u32(options.contextLength ?? 32768)]),
  ];
  const template = options.chatTemplate === undefined ? FAKE_GEMMA_TEMPLATE : options.chatTemplate;
  if (template !== null) entries.push(Buffer.concat([str('tokenizer.chat_template'), u32(STRING), str(template)]));
  const header = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(entries.length), ...entries]);
  await writeFile(path, Buffer.concat([header, Buffer.alloc(options.paddingBytes ?? 0)]));
}
