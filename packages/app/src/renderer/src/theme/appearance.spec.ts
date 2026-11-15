/**
 * The look the person chose, applied to the root: the theme forced or
 * Windows' (followed as it changes), the accent, the text size, the density,
 * a code font from the list only.
 */

import { describe, expect, it } from 'vitest';
import { applyAppearance, type AppearanceRoot } from './appearance';

function fakeRoot() {
  const properties: Record<string, string> = {};
  const root: AppearanceRoot = { dataset: {}, style: { setProperty: (name, value) => void (properties[name] = value) } };
  return { root, properties };
}

function fakeMedia(dark: boolean) {
  let listener: (() => void) | null = null;
  const media = {
    matches: dark,
    addEventListener: (_: string, next: () => void) => void (listener = next),
    removeEventListener: () => void (listener = null),
  };
  return { media: media as unknown as MediaQueryList, flip: (to: boolean) => ((media.matches = to), listener?.()) };
}

describe('the appearance', () => {
  it('forces a theme, or follows Windows as it changes', () => {
    const { root } = fakeRoot();
    const system = fakeMedia(false);
    applyAppearance({ theme: 'dark' }, root, system.media);
    expect(root.dataset).toMatchObject({ bonaparteTheme: 'dark', aparteTheme: 'dark' });
    applyAppearance({ theme: 'system' }, root, system.media);
    expect(root.dataset).toMatchObject({ bonaparteTheme: 'system', aparteTheme: 'light' });
    system.flip(true);
    expect(root.dataset['aparteTheme']).toBe('dark');
    applyAppearance({ theme: 'light' }, root, system.media);
    system.flip(false);
    system.flip(true);
    expect(root.dataset['aparteTheme']).toBe('light');
  });

  it('sets the accent, the text size and the density; blue is the default accent', () => {
    const { root, properties } = fakeRoot();
    applyAppearance({ accent: 'violet', textSize: 'large', listDensity: 'compact' }, root, fakeMedia(false).media);
    expect(root.dataset).toMatchObject({ bonaparteAccent: 'violet', bonaparteDensity: 'compact' });
    expect(properties['--aparte-font-scale']).toBe('1.15');
    applyAppearance({ accent: 'blue' }, root, fakeMedia(false).media);
    expect(root.dataset['bonaparteAccent']).toBeUndefined();
  });

  it('takes a code font from its list only', () => {
    const { root, properties } = fakeRoot();
    applyAppearance({ codeFont: 'Consolas' }, root, fakeMedia(false).media);
    expect(properties['--aparte-code-font-family']).toBe("'Consolas', ui-monospace, monospace");
    applyAppearance({ codeFont: "x'; } body { display: none" }, root, fakeMedia(false).media);
    expect(properties['--aparte-code-font-family']).toBe("'JetBrains Mono', ui-monospace, monospace");
  });
});
