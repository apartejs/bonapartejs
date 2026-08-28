/**
 * UI i18n — one locale = one file (fr.ts, en.ts), the interface in
 * types.ts. This module is the stable entry point.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import { EN } from './en.js';
import { FR } from './fr.js';
import type { AppTranslations } from './types.js';

export type { AppTranslations } from './types.js';
export { EN } from './en.js';
export { FR } from './fr.js';

export const APP_LOCALES: Record<BonaparteLocale, AppTranslations> = {
  fr: FR,
  en: EN,
};
