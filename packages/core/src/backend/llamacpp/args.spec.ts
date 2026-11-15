import { describe, expect, it } from 'vitest';
import { buildLlamaServerArgs } from './args.js';

const base = { modelPath: 'D:\\models\\qwen3.gguf', port: 8123 };

function pair(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildLlamaServerArgs', () => {
  it('includes the model and the port', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '-m')).toBe(base.modelPath);
    expect(pair(args, '--port')).toBe('8123');
  });

  it('listens on this machine only, always', () => {
    expect(pair(buildLlamaServerArgs(base), '--host')).toBe('127.0.0.1');
  });

  it('asks for one slot unless told otherwise, and always says how many', () => {
    // The server's own default is "auto", which sizes the slots itself: the
    // context it gives each one is then not the one we announced.
    expect(pair(buildLlamaServerArgs(base), '-np')).toBe('1');
    expect(pair(buildLlamaServerArgs({ ...base, slots: 3 }), '-np')).toBe('3');
    expect(buildLlamaServerArgs(base)).not.toContain('--parallel');
  });

  it('puts every layer on the graphics card unless told otherwise', () => {
    // The server's own default is "auto", which may leave layers on the
    // processor without saying so: a model three times slower, unannounced.
    expect(pair(buildLlamaServerArgs(base), '-ngl')).toBe('999');
    expect(pair(buildLlamaServerArgs({ ...base, gpuLayers: 'all' }), '-ngl')).toBe('999');
  });

  it('puts the number of layers it is given on the graphics card', () => {
    expect(pair(buildLlamaServerArgs({ ...base, gpuLayers: 20 }), '-ngl')).toBe('20');
    expect(pair(buildLlamaServerArgs({ ...base, gpuLayers: 0 }), '-ngl')).toBe('0');
  });

  it('refuses a number of layers that is not a whole number, or negative', () => {
    expect(() => buildLlamaServerArgs({ ...base, gpuLayers: -1 })).toThrow(/layers/);
    expect(() => buildLlamaServerArgs({ ...base, gpuLayers: 2.5 })).toThrow(/layers/);
  });

  it('always forces -fa on (never auto)', () => {
    expect(pair(buildLlamaServerArgs(base), '-fa')).toBe('on');
  });

  it('symmetric KV types by default (f16/f16)', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '--cache-type-k')).toBe('f16');
    expect(pair(args, '--cache-type-v')).toBe('f16');
  });

  it('only one KV type provided: the other is aligned', () => {
    const args = buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0' });
    expect(pair(args, '--cache-type-k')).toBe('q8_0');
    expect(pair(args, '--cache-type-v')).toBe('q8_0');
  });

  it('explicit asymmetric KV types: an error (a silent slow path upstream)', () => {
    expect(() => buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0', cacheTypeV: 'f16' })).toThrow(/symmetric/);
  });

  it('maps the options to the right flags', () => {
    const args = buildLlamaServerArgs({ ...base, nCtx: 32768, slotSavePath: 'C:\\bp\\kv-slots' });
    expect(pair(args, '-c')).toBe('32768');
    expect(pair(args, '--slot-save-path')).toBe('C:\\bp\\kv-slots');
  });

  it('emits no flag for an absent option', () => {
    const args = buildLlamaServerArgs(base);
    expect(args).not.toContain('--slot-save-path');
    expect(args).not.toContain('-c');
  });

  it('never leaves context shift to the server', () => {
    // A silent shift would drop the head of the prompt behind our back, and
    // with it the prefix every saved KV state depends on. Overflow is an
    // explicit event on our side, never a truncation on the server's.
    const args = buildLlamaServerArgs(base);
    expect(args).toContain('--no-context-shift');
    expect(args).not.toContain('--context-shift');
  });

  it('turns the web UI off: nobody browses to our server', () => {
    expect(buildLlamaServerArgs(base)).toContain('--no-webui');
  });

  it('keeps no prompt cache of its own in the server: the app keeps the memory, and says what it costs', () => {
    expect(pair(buildLlamaServerArgs(base), '--cache-ram')).toBe('0');
  });

  it('never carries the key: it travels in the environment', () => {
    const args = buildLlamaServerArgs(base);
    expect(args).not.toContain('--api-key');
    expect(args).not.toContain('--api-key-file');
  });
});
