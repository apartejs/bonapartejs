/**
 * What aparté needs before the chat renders: how to format a reply, how to
 * colour its code, and which language its own strings speak.
 */

import type { Locale } from '@aparte/bonaparte-shared';
import { aparteGlobalConfig } from '@aparte/core';
import { fr } from '@aparte/locales/fr';
import { setupShikiProvider } from '@aparte/plugin-shiki';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';

export function setupAparte(locale: Locale): void {
  setupStreamingMarkdownProvider();
  setupShikiProvider({ theme: { light: 'github-light', dark: 'github-dark' } });
  if (locale === 'fr') aparteGlobalConfig.setLocale(fr);
  else aparteGlobalConfig.resetLocale();
}
