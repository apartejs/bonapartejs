/**
 * « Réglages · Apparence » (board): the theme as cards with their miniature,
 * the accent as four swatches, then reading — the text size, the density of
 * the lists, the font of the code. Each choice applies at once.
 */

import { CODE_FONTS } from '../theme/appearance';
import { Choice, Row, Section } from './controls';
import type { PageProps } from './SettingsView';

const THEMES = ['light', 'dark', 'system'] as const;
const ACCENTS = ['blue', 'teal', 'violet', 'orange'] as const;

export function AppearancePage({ messages, values, change }: PageProps) {
  const words = messages.settings.appearance;
  const theme = THEMES.find((one) => one === values['theme']) ?? 'system';
  const accent = ACCENTS.find((one) => one === values['accent']) ?? 'blue';
  return (
    <div className="settings__sections">
      <Section title={words.theme}>
        <div role="radiogroup" aria-label={words.theme} className="theme-cards">
          {THEMES.map((one) => (
            <label key={one} className={`aparte-field-choice aparte-field-choice--boxed theme-card${theme === one ? ' aparte-field-choice--selected' : ''}`}>
              <input type="radio" className="setting-radio" name="theme" checked={theme === one} onChange={() => change('theme', one)} />
              <span className={`theme-card__miniature theme-card__miniature--${one}`} aria-hidden="true">
                <span className="theme-card__sidebar" />
                <span className="theme-card__body" />
              </span>
              <span className="theme-card__label">{words[one]}</span>
            </label>
          ))}
        </div>
      </Section>
      <Section title={words.accent} single>
        <Row
          label={words.accent}
          hint={words.accentHint}
          control={
            <div role="radiogroup" aria-label={words.accent} className="accent-swatches">
              {ACCENTS.map((one) => (
                <label key={one} className={`accent-swatch accent-swatch--${one}`}>
                  <input
                    type="radio"
                    className="setting-radio"
                    name="accent"
                    aria-label={words.accents[one]}
                    checked={accent === one}
                    onChange={() => change('accent', one)}
                  />
                </label>
              ))}
            </div>
          }
        />
      </Section>
      <Section title={words.reading}>
        <Row
          label={words.textSize}
          control={
            <Choice
              label={words.textSize}
              value={values['textSize'] === 'small' || values['textSize'] === 'large' ? values['textSize'] : 'normal'}
              options={[
                { value: 'small', label: words.small },
                { value: 'normal', label: words.normal },
                { value: 'large', label: words.large },
              ]}
              onChange={(next) => change('textSize', next)}
            />
          }
        />
        <Row
          label={words.density}
          control={
            <Choice
              label={words.density}
              value={values['listDensity'] === 'compact' ? 'compact' : 'comfortable'}
              options={[
                { value: 'comfortable', label: words.comfortable },
                { value: 'compact', label: words.compact },
              ]}
              onChange={(next) => change('listDensity', next)}
            />
          }
        />
        <Row
          label={words.codeFont}
          control={
            <select
              className="aparte-field code-font"
              aria-label={words.codeFont}
              value={CODE_FONTS.find((one) => one === values['codeFont']) ?? CODE_FONTS[0]}
              onChange={(event) => change('codeFont', event.target.value)}
            >
              {CODE_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          }
        />
      </Section>
    </div>
  );
}
