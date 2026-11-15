/**
 * Sizes on screen are binary (1 Go = 1 024³ bytes), written Mo and Go as
 * Windows writes them, and the numbers follow the language of the interface.
 */

import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatSeconds, formatTokens } from './format.js';

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

describe('formatDuration', () => {
  it('writes a short wait to the tenth, a longer one to the second, a long one in minutes', () => {
    expect(formatDuration(0.6, 'fr')).toBe('0,6 s');
    expect(formatDuration(12.4, 'fr')).toBe('12 s');
    expect(formatDuration(170, 'fr')).toBe('2 min 50');
    expect(formatDuration(240, 'en')).toBe('4 min');
    expect(formatDuration(0.04, 'en')).toBe('0.1 s');
  });

  it('rounds before it splits: never « 1 min 60 », never « 60 s »', () => {
    expect(formatDuration(119.7, 'fr')).toBe('2 min');
    expect(formatDuration(59.6, 'fr')).toBe('1 min');
    expect(formatDuration(9.97, 'fr')).toBe('10 s');
  });
});

describe('formatTokens', () => {
  it("groups thousands as the language does", () => {
    expect(formatTokens(31_240, 'fr').replace(/\s/g, ' ')).toBe('31 240');
    expect(formatTokens(31_240, 'en')).toBe('31,240');
  });
});
