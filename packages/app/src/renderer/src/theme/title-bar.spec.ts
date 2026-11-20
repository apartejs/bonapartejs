/**
 * The colours of the window's buttons (drawn by the system over the app): the app's tokens, as the page resolves
 * them, sent as hex — the only form the main process accepts.
 */

import { describe, expect, it } from 'vitest';
import { hexOf } from './title-bar';

describe('a colour the page resolved, as the window takes it', () => {
  it('rgb() and rgba() become #rrggbb', () => {
    expect(hexOf('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(hexOf('rgb(29, 29, 27)')).toBe('#1d1d1b');
    expect(hexOf('rgba(8, 126, 164, 1)')).toBe('#087ea4');
  });

  it('a colour it cannot read is none: the window keeps the colours it had', () => {
    expect(hexOf('oklch(0.4 0.1 156)')).toBeNull();
    expect(hexOf('')).toBeNull();
  });
});
