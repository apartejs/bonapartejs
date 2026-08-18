import { describe, expect, it } from 'vitest';
import {
  isSupportedLlamaBuild,
  MIN_LLAMA_BUILD,
  parseLlamaBuildNumber,
} from './version.js';

describe('parseLlamaBuildNumber', () => {
  it.each([
    ['b10217-ddd4ec142', 10217],
    ['version: 3952 (abc1234)', 3952],
    ['llama-server b6521', 6521],
    ['build: b7100 (deadbeef)\nqqch d’autre', 7100],
    ['  b6000  ', 6000],
  ])('%s → %d', (output, expected) => {
    expect(parseLlamaBuildNumber(output)).toBe(expected);
  });

  it.each([[''], ['sortie sans numéro'], ['v1.2.3 pas un build llama']])(
    'sortie inexploitable %s → null',
    (output) => {
      expect(parseLlamaBuildNumber(output)).toBeNull();
    },
  );

  it('ne confond pas un petit nombre isolé avec un build (ex. « 4 threads »)', () => {
    expect(parseLlamaBuildNumber('using 4 threads')).toBeNull();
  });
});

describe('isSupportedLlamaBuild', () => {
  it('accepte le minimum et au-dessus, refuse en dessous', () => {
    expect(isSupportedLlamaBuild(MIN_LLAMA_BUILD)).toBe(true);
    expect(isSupportedLlamaBuild(MIN_LLAMA_BUILD + 4000)).toBe(true);
    expect(isSupportedLlamaBuild(MIN_LLAMA_BUILD - 1)).toBe(false);
  });
});
