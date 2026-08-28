/**
 * Harness i18n — one locale = one file (fr.ts, en.ts), the interface lives
 * in types.ts. This module is the stable entry point (harnessT +
 * re-exports).
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import { EN } from './en.js';
import { FR } from './fr.js';
import type { HarnessTranslations } from './types.js';

export type { HarnessTranslations } from './types.js';
export { EN } from './en.js';
export { FR } from './fr.js';

const LOCALES: Record<BonaparteLocale, HarnessTranslations> = { fr: FR, en: EN };

export function harnessT(locale: BonaparteLocale): HarnessTranslations {
  return LOCALES[locale];
}
