/**
 * The colours of the window's buttons, which the system draws over the app (`titleBarOverlay`, `main/title-bar.ts`):
 * the tokens of the page as it resolves them — the background the buttons sit on, and the muted ink of their
 * glyphs — sent again whenever the look changes (the theme, Windows' own, the accent). No colour is written here.
 */

import { windowTitleBar } from '@aparte/bonaparte-shared';
import { bridge } from '../bridge';

/** A colour the page resolved (`rgb()`, `rgba()`), as `#rrggbb`; null for one it cannot read. */
export function hexOf(resolved: string): string | null {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(resolved.trim());
  if (!match) return null;
  return `#${match
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The colour a token resolves to here: a probe styled by it, read back. */
function resolve(token: string, probe: HTMLElement): string | null {
  probe.style.color = `var(${token})`;
  return hexOf(getComputedStyle(probe).color);
}

let last = '';

export function syncTitleBar(): void {
  const probe = document.createElement('span');
  probe.hidden = true;
  // The app's own colours, whatever contrast theme Windows forces on the page.
  probe.style.setProperty('forced-color-adjust', 'none');
  document.body.append(probe);
  const color = resolve('--aparte-bg', probe);
  const symbolColor = resolve('--aparte-text-muted', probe);
  probe.remove();
  if (!color || !symbolColor) return;
  const key = `${color}/${symbolColor}`;
  if (key === last) return;
  last = key;
  void bridge.invoke(windowTitleBar, { color, symbolColor }).catch(() => undefined);
}

/** Sends the colours now, and again whenever the root's look changes (its theme, its accent). */
export function followTitleBar(root: HTMLElement = document.documentElement): () => void {
  syncTitleBar();
  const observer = new MutationObserver(() => syncTitleBar());
  observer.observe(root, { attributes: true, attributeFilter: ['data-aparte-theme', 'data-bonaparte-accent', 'data-bonaparte-theme'] });
  return () => observer.disconnect();
}
