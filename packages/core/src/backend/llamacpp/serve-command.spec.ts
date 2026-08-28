import { describe, expect, it } from 'vitest';
import { detectServeCommandPrefix } from './serve-command.js';

describe('detectServeCommandPrefix', () => {
  it.each([
    'C:\\tools\\llama\\llama-server.exe',
    '/usr/local/bin/llama-server',
    'llama-server',
  ])('binaire historique %s → aucun préfixe', (binPath) => {
    expect(detectServeCommandPrefix(binPath)).toEqual([]);
  });

  it.each([
    'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\llama.exe',
    '/usr/local/bin/llama',
    'llama',
    'LLAMA.EXE',
  ])('CLI unifié %s → préfixe serve', (binPath) => {
    expect(detectServeCommandPrefix(binPath)).toEqual(['serve']);
  });

  it('un nom inconnu est traité comme le binaire historique (pas de préfixe)', () => {
    expect(detectServeCommandPrefix('C:\\bin\\mon-serveur-custom.exe')).toEqual([]);
  });
});
