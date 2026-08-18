/**
 * i18n de l'UI — une locale = un fichier (fr.ts, en.ts), l'interface dans
 * types.ts. Ce module est le point d'entrée stable.
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
