/**
 * The look the person chose (Settings, Appearance — task 5.7), applied to
 * the document's root at once: the theme (or Windows'), the accent, the text
 * size, the density of the lists, the font of the code. Every colour stays a
 * token: this only says which tokens apply.
 */

export interface AppearanceRoot {
  dataset: DOMStringMap;
  style: { setProperty(name: string, value: string): void };
}

/** aparté's font scale for each text size of the board (12, 13, 15 px for 13 at 1). */
export const TEXT_SCALE = { small: '0.92', normal: '1', large: '1.15' } as const;

/** The code fonts offered: a name of the list, never a free text that would end in a stylesheet. */
export const CODE_FONTS = ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'Fira Code', 'Source Code Pro'] as const;

const DARK = '(prefers-color-scheme: dark)';
let stopFollowing: (() => void) | null = null;

export function applyAppearance(
  values: Record<string, unknown>,
  root: AppearanceRoot = document.documentElement,
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> = window.matchMedia(DARK),
): void {
  if ('theme' in values) {
    const theme = values['theme'] === 'light' || values['theme'] === 'dark' ? values['theme'] : 'system';
    root.dataset['bonaparteTheme'] = theme;
    stopFollowing?.();
    stopFollowing = null;
    if (theme === 'system') {
      const follow = (): void => {
        root.dataset['aparteTheme'] = media.matches ? 'dark' : 'light';
      };
      follow();
      media.addEventListener('change', follow);
      stopFollowing = () => media.removeEventListener('change', follow);
    } else {
      root.dataset['aparteTheme'] = theme;
    }
  }
  if ('accent' in values) {
    const accent = values['accent'];
    if (accent === 'teal' || accent === 'violet' || accent === 'orange') root.dataset['bonaparteAccent'] = accent;
    else delete root.dataset['bonaparteAccent'];
  }
  if ('textSize' in values) {
    const size = values['textSize'] === 'small' || values['textSize'] === 'large' ? values['textSize'] : 'normal';
    root.style.setProperty('--aparte-font-scale', TEXT_SCALE[size]);
  }
  if ('listDensity' in values) {
    root.dataset['bonaparteDensity'] = values['listDensity'] === 'compact' ? 'compact' : 'comfortable';
  }
  if ('codeFont' in values) {
    const font = CODE_FONTS.find((one) => one === values['codeFont']) ?? CODE_FONTS[0];
    root.style.setProperty('--aparte-code-font-family', `'${font}', ui-monospace, monospace`);
  }
}
