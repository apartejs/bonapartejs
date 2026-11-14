import type { Locale } from '@aparte/bonaparte-shared';
import { en } from './en.js';
import { fr } from './fr.js';
import type { Messages } from './types.js';

export type { Messages } from './types.js';

const byLocale: Record<Locale, Messages> = { fr, en };

export function messagesFor(locale: Locale): Messages {
  return byLocale[locale];
}
