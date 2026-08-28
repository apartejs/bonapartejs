import { describe, expect, it } from 'vitest';
import { detectServeCommandPrefix } from './serve-command.js';

describe('detectServeCommandPrefix', () => {
  it.each([
    'C:\\tools\\llama\\llama-server.exe',
    '/usr/local/bin/llama-server',
    'llama-server',
  ])('historical binary %s → no prefix', (binPath) => {
    expect(detectServeCommandPrefix(binPath)).toEqual([]);
  });

  it.each([
    'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\llama.exe',
    '/usr/local/bin/llama',
    'llama',
    'LLAMA.EXE',
  ])('unified CLI %s → serve prefix', (binPath) => {
    expect(detectServeCommandPrefix(binPath)).toEqual(['serve']);
  });

  it('an unknown name is treated as the historical binary (no prefix)', () => {
    expect(detectServeCommandPrefix('C:\\bin\\mon-serveur-custom.exe')).toEqual([]);
  });
});
