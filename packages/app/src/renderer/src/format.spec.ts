/**
 * Sizes on screen are binary (1 Go = 1 024³ bytes), written Mo and Go as
 * Windows writes them, and the numbers follow the language of the interface.
 */

import { describe, expect, it } from 'vitest';
import { formatBytes, formatSeconds } from './format.js';

const fr = { locale: 'fr', units: { b: 'o', kb: 'Ko', mb: 'Mo', gb: 'Go' } } as const;
const en = { locale: 'en', units: { b: 'B', kb: 'KB', mb: 'MB', gb: 'GB' } } as const;

const KiB = 1024;
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

describe('formatBytes', () => {
  it('writes gigabytes with one decimal at most, in the comma of the language', () => {
    expect(formatBytes(21.3 * GiB, fr)).toBe('21,3 Go');
    expect(formatBytes(21.3 * GiB, en)).toBe('21.3 GB');
    expect(formatBytes(24 * GiB, fr)).toBe('24 Go');
  });

  it('counts in powers of 1 024, not 1 000', () => {
    // 1 000 000 000 bytes are 0.93 GiB: shown as megabytes, never as "1 Go".
    expect(formatBytes(1_000_000_000, fr)).toBe('954 Mo');
  });

  it('writes the smaller sizes in Mo, Ko and bytes', () => {
    expect(formatBytes(280 * MiB, fr)).toBe('280 Mo');
    expect(formatBytes(3 * MiB, fr)).toBe('3 Mo');
    expect(formatBytes(20 * KiB, fr)).toBe('20 Ko');
    expect(formatBytes(512, en)).toBe('512 B');
  });
});

describe('formatSeconds', () => {
  it('rounds to a whole second, and never says zero', () => {
    expect(formatSeconds(21.6)).toBe('22');
    expect(formatSeconds(0.2)).toBe('1');
  });
});
