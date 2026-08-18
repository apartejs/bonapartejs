import { describe, expect, it } from 'vitest';
import { buildLlamaServerArgs } from './args.js';

const base = { modelPath: 'D:\\models\\qwen3.gguf', port: 8123 };

function pair(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildLlamaServerArgs', () => {
  it('inclut le modèle, le port et un host loopback', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '-m')).toBe(base.modelPath);
    expect(pair(args, '--port')).toBe('8123');
    expect(pair(args, '--host')).toBe('127.0.0.1');
  });

  it('force toujours -fa on (jamais auto)', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '-fa')).toBe('on');
  });

  it('types KV symétriques par défaut (f16/f16)', () => {
    const args = buildLlamaServerArgs(base);
    expect(pair(args, '--cache-type-k')).toBe('f16');
    expect(pair(args, '--cache-type-v')).toBe('f16');
  });

  it('un seul type KV fourni ⇒ l’autre est aligné', () => {
    const args = buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0' });
    expect(pair(args, '--cache-type-k')).toBe('q8_0');
    expect(pair(args, '--cache-type-v')).toBe('q8_0');
  });

  it('types KV asymétriques explicites ⇒ erreur (chemin lent silencieux upstream)', () => {
    expect(() =>
      buildLlamaServerArgs({ ...base, cacheTypeK: 'q8_0', cacheTypeV: 'f16' }),
    ).toThrow(/symétriques/);
  });

  it('mappe les options vers les bons flags', () => {
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

  it('ajoute extraFlags en dernier, tels quels', () => {
    const args = buildLlamaServerArgs({
      ...base,
      extraFlags: ['--rope-scaling', 'yarn', '--verbose'],
    });
    expect(args.slice(-3)).toEqual(['--rope-scaling', 'yarn', '--verbose']);
  });

  it('n’émet pas de flags pour les options absentes', () => {
    const args = buildLlamaServerArgs(base);
    expect(args).not.toContain('--slot-save-path');
    expect(args).not.toContain('-ngl');
    expect(args).not.toContain('--load-mode');
  });
});
