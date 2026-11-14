/**
 * Which family a model belongs to is read in the chat template its GGUF
 * carries. A model without a template, or of a family the built-in engine
 * does not speak yet, is refused clearly — with the way out: a service.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGgufInfo } from '../models/gguf.js';
import { detectFamily, familyLayer, layerForModel, UnsupportedFamilyError } from './index.js';

const TEMPLATES = {
  qwen: "{%- for message in messages %}{{- '<|im_start|>' + message.role + '\\n' + message.content + '<|im_end|>' }}{%- endfor %}",
  // Gemma 4: the turns of its official template.
  gemma: "{{- bos_token -}}{%- for message in messages -%}{{- '<|turn>' + role + '\\n' -}}{{- message['content'] | trim -}}{{- '<turn|>\\n' -}}{%- endfor -%}",
  llama: "{{- '<|start_header_id|>' + message['role'] + '<|end_header_id|>\\n\\n' + message['content'] | trim + '<|eot_id|>' }}",
  mistral: "{%- for message in messages %}{%- if message['role'] == 'user' %}{{- '[INST] ' + message['content'] + '[/INST]' }}{%- endif %}{%- endfor %}",
  'gpt-oss': "{{- '<|start|>assistant<|channel|>analysis<|message|>' + message.thinking + '<|end|>' }}",
} as const;

/** Gemma 2 and 3: `<start_of_turn>`, no native tool calls — not the format of Gemma 4. */
const OLDER_GEMMA =
  "{{ bos_token }}{% for message in messages %}{{ '<start_of_turn>' + role + '\\n' + message['content'] | trim + '<end_of_turn>\\n' }}{% endfor %}";

describe('detectFamily', () => {
  for (const [family, template] of Object.entries(TEMPLATES)) {
    it(`reads ${family} in its template`, () => {
      expect(detectFamily(template)).toBe(family);
    });
  }

  it('does not guess a template it does not know', () => {
    expect(detectFamily('{% for m in messages %}### {{ m.role }}: {{ m.content }}{% endfor %}')).toBeNull();
  });

  it('does not take an older Gemma (2, 3) for Gemma 4: another format', () => {
    expect(detectFamily(OLDER_GEMMA)).toBeNull();
  });

  it('has nothing to say without a template', () => {
    expect(detectFamily(undefined)).toBeNull();
    expect(detectFamily('')).toBeNull();
  });
});

describe('layerForModel', () => {
  it('gives the layer of the family the model speaks', () => {
    expect(layerForModel({ chatTemplate: TEMPLATES.qwen }).id).toBe('qwen');
    expect(layerForModel({ chatTemplate: TEMPLATES.gemma }).id).toBe('gemma');
  });

  it('refuses a model without a chat template, and says a service can run it', () => {
    let error: unknown;
    try {
      layerForModel({});
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnsupportedFamilyError);
    expect(error).toMatchObject({ code: 'no-chat-template', suggestion: 'use-external-provider' });
  });

  it('refuses a family the built-in engine does not speak yet, and a template it does not know', () => {
    for (const template of [OLDER_GEMMA, TEMPLATES.llama, TEMPLATES.mistral, TEMPLATES['gpt-oss'], '### {{ m }}']) {
      expect(() => layerForModel({ chatTemplate: template })).toThrow(UnsupportedFamilyError);
      try {
        layerForModel({ chatTemplate: template });
      } catch (error) {
        expect(error).toMatchObject({ code: 'unsupported-family', suggestion: 'use-external-provider' });
      }
    }
  });

  it('familyLayer refuses the same way a family without its layer', () => {
    expect(() => familyLayer('llama')).toThrow(UnsupportedFamilyError);
  });
});

describe('readGgufInfo — the family', () => {
  let dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs = [];
  });

  /** A GGUF v3 header with an architecture, its blocks, and maybe a template. */
  async function gguf(template?: string): Promise<string> {
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
    const entries: Buffer[] = [
      Buffer.concat([str('general.architecture'), u32(8), str('qwen3')]),
      Buffer.concat([str('qwen3.block_count'), u32(4), u32(2)]),
      Buffer.concat([str('qwen3.embedding_length'), u32(4), u32(256)]),
      Buffer.concat([str('qwen3.attention.head_count'), u32(4), u32(4)]),
    ];
    if (template !== undefined) entries.push(Buffer.concat([str('tokenizer.chat_template'), u32(8), str(template)]));
    const dir = await mkdtemp(join(tmpdir(), 'bp-family-'));
    dirs.push(dir);
    const path = join(dir, 'model.gguf');
    await writeFile(path, Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(entries.length), ...entries]));
    return path;
  }

  it('is read from the template the header carries', async () => {
    expect((await readGgufInfo(await gguf(TEMPLATES.qwen))).family).toBe('qwen');
    expect((await readGgufInfo(await gguf(TEMPLATES.gemma))).family).toBe('gemma');
  });

  it('is null without a template: sizing the model still works', async () => {
    const info = await readGgufInfo(await gguf());
    expect(info.family).toBeNull();
    expect(info.blockCount).toBe(2);
  });
});
