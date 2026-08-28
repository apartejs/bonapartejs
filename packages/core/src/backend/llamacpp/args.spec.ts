import { describe, expect, it } from 'vitest';
import { buildLlamaServerArgs } from './args.js';

const base = { modelPath: 'D:\\models\\qwen3.gguf', port: 8123 };

function pair(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildLlamaServerArgs', () => {
  it('includes the model, the port, and a loopback host', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '-m')).toBe(base.modelPath);
    expect(pair(args, '--port')).toBe('8123');
    expect(pair(args, '--host')).toBe('127.0.0.1');
  });

  it('always forces -fa on (never auto)', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '-fa')).toBe('on');
  });

  it('symmetric KV types by default (f16/f16)', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '--cache-type-k')).toBe('f16');
    expect(pair(args, '--cache-type-v')).toBe('f16');
  });

  it('only one KV type provided ⇒ the other is aligned', () => {
    const args = buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0' });
    expect(pair(args, '--cache-type-k')).toBe('q8_0');
    expect(pair(args, '--cache-type-v')).toBe('q8_0');
  });

  it('explicit asymmetric KV types ⇒ error (silent slow path upstream)', () => {
    expect(() =>
      buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0', cacheTypeV: 'f16' }),
    ).toThrow(/symmetric/);
  });

  it('maps the options to the right flags', () => {
    const args = buildLlamaServerArgs({
      ...base,
      nCtx: 32768,
      nGpuLayers: 99,
      slotSavePath: 'C:\\bp\\kv-slots',
      parallelSlots: 1,
      cacheReuse: 256,
      threads: 8,
      loadMode: 'mmap',
    });
    expect(pair(args, '-c')).toBe('32768');
    expect(pair(args, '-ngl')).toBe('99');
    expect(pair(args, '--slot-save-path')).toBe('C:\\bp\\kv-slots');
    expect(pair(args, '--parallel')).toBe('1');
    expect(pair(args, '--cache-reuse')).toBe('256');
    expect(pair(args, '--threads')).toBe('8');
    expect(pair(args, '--load-mode')).toBe('mmap');
  });

  it('appends extraFlags last, as-is', () => {
    const args = buildLlamaServerArgs({
      ...base,
      extraFlags: ['--rope-scaling', 'yarn', '--verbose'],
    });
    expect(args.slice(-3)).toEqual(['--rope-scaling', 'yarn', '--verbose']);
  });

  it('emits no flags for absent options', () => {
    const args = buildLlamaServerArgs(base);
    expect(args).not.toContain('--slot-save-path');
    expect(args).not.toContain('-ngl');
    expect(args).not.toContain('--load-mode');
  });

  it('never leaves context shift to the server (D-22)', () => {
    // A silent shift would drop the head of the prompt behind our back —
    // and with it the prefix every saved KV state depends on. Overflow is
    // an explicit event on our side, never a truncation on the server's.
    const args = buildLlamaServerArgs({ modelPath: 'm.gguf', port: 1 });
    expect(args).toContain('--no-context-shift');
    expect(args).not.toContain('--context-shift');
  });
});
