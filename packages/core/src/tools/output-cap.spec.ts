/**
 * What a tool gives back is cut to a quarter of the context, counted at
 * three characters a token, and never more than 30,000 characters: a long
 * output must not fill the conversation. The cut is said to the model.
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

  it('cuts a longer one, and says how much was left out', () => {
    const long = 'x'.repeat(10_000);
    const capped = capToolOutput(long, 8_192);
    expect(capped.startsWith('x'.repeat(6_144))).toBe(true);
    expect(capped).not.toContain('x'.repeat(6_145));
    expect(capped).toMatch(/\[The output was cut: 3[,]?856 more characters were not shown\.\]$/);
  });
});
