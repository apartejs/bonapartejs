import type { Locale } from '@aparte/bonaparte-shared';
import { en } from './en.js';
import { fr } from './fr.js';
import type { MainWords } from './types.js';

export type { MainWords } from './types.js';

export function mainWords(locale: Locale): MainWords {
  return locale === 'fr' ? fr : en;
}
