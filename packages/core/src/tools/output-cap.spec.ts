/**
 * What a tool gives back is cut to a quarter of the context, counted at
 * three characters a token, and never more than 30,000 characters: a long
 * output must not fill the conversation. The cut falls in the middle — the
 * end of a test run holds its failures and its exit code — and is said to the
 * model (audit 2026-11-21, D5).
 */

import { describe, expect, it } from 'vitest';
import { capToolOutput, maxToolOutputChars } from './output-cap.js';

describe('maxToolOutputChars', () => {
  it('is a quarter of the context at three characters a token, never more than 30,000', () => {
    expect(maxToolOutputChars(8_192)).toBe(6_144);
    expect(maxToolOutputChars(32_768)).toBe(24_576);
    expect(maxToolOutputChars(40_000)).toBe(30_000);
    expect(maxToolOutputChars(131_072)).toBe(30_000);
  });
});

describe('capToolOutput', () => {
  it('leaves an output that fits as it is', () => {
    expect(capToolOutput('short', 8_192)).toBe('short');
  });

  it('cuts a longer one in the middle — a third of the head, two thirds of the tail — and says how much was left out (audit 2026-11-21, D5)', () => {
    const long = 'x'.repeat(10_000);
    const capped = capToolOutput(long, 8_192);
    // 6,144 at most, its note included: 6,024 kept, 2,008 of the head, 4,016 of the tail.
    expect(capped.length).toBeLessThanOrEqual(6_144);
    expect(capped.startsWith(`${'x'.repeat(2_008)}\n[`)).toBe(true);
    expect(capped.endsWith(`]\n${'x'.repeat(4_016)}`)).toBe(true);
    expect(capped).toMatch(/\[The output was cut in the middle: 3,976 characters were left out\.\]/);
    // Cut once, it is not cut again.
    expect(capToolOutput(capped, 8_192)).toBe(capped);
  });

  it('a head and a tail joined, with what was left out between them, say the whole of it', () => {
    const joined = `${'a'.repeat(5_000)}${'b'.repeat(5_000)}`;
    const capped = capToolOutput(joined, 8_192, { characters: 1_000_000, lines: 10_000 });
    expect(capped).toMatch(/\[The output was cut in the middle: 10,000 lines \(1,003,976 characters\) were left out\.\]/);
  });

  it('a test run’s failures and its exit code, which come last, are kept; the cut falls between lines and counts them', () => {
    const passing = Array.from({ length: 400 }, (_, n) => ` ✓ test number ${n} passes`).join('\n');
    const output = `$ pnpm test\n${passing}\n FAIL src/a.spec.ts > adds\nAssertionError: expected 3 to be 4\n Tests 1 failed | 400 passed\n[exit code 1]`;
    const capped = capToolOutput(output, 8_192);
    expect(capped.length).toBeLessThanOrEqual(6_144 + 200);
    expect(capped.startsWith('$ pnpm test\n')).toBe(true);
    expect(capped).toContain('AssertionError: expected 3 to be 4');
    expect(capped.endsWith('[exit code 1]')).toBe(true);
    const said = /\[The output was cut in the middle: ([\d,]+) lines \(([\d,]+) characters\) were left out\.\]/.exec(capped);
    expect(said).not.toBeNull();
    // Whole lines on each side of the cut.
    const [head, tail] = capped.split(said![0]);
    expect(head!.endsWith('\n')).toBe(true);
    expect(tail!.startsWith('\n')).toBe(true);
    const kept = head!.length - 1 + tail!.length - 1;
    expect(Number(said![2]!.replace(/,/g, ''))).toBe(output.length - kept);
    const lines = Number(said![1]!.replace(/,/g, ''));
    expect(lines).toBe(output.split('\n').length - (head!.split('\n').length - 1) - (tail!.split('\n').length - 1));
  });
});
