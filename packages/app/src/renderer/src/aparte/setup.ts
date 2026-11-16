/**
 * What aparté needs before the chat renders: how to format a reply, how to
 * colour its code, which language its own strings speak, and the window's
 * own tool: the question the model asks the person (`ask_user`).
 */

import type { Locale } from '@aparte/bonaparte-shared';
import { aparteGlobalConfig } from '@aparte/core';
import { fr } from '@aparte/locales/fr';
import { setupAskUser } from '@aparte/plugin-ask-user';
import { setupShikiProvider } from '@aparte/plugin-shiki';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';

export function setupAparte(locale: Locale): void {
  setupStreamingMarkdownProvider();
  setupShikiProvider({ theme: { light: 'github-light', dark: 'github-dark' } });
  // The model's question to the person: a tool the window runs, its receipt left in the thread.
  // Its options answer to 1 to 9 and Escape is « Laisse-le choisir » (aparté 1.10); an answer is
  // changed by the next message, not on its receipt (apartejs/aparte#223).
  setupAskUser();
  // A message written while a reply runs waits above the field, and goes when the reply ends — after a Stop it
  // comes back into the field (board « … sous-agents au travail »: « ton message attendra »; aparté 1.12,
  // apartejs/aparte#248).
  aparteGlobalConfig.setQueueWhileStreaming(true);
  setAparteLocale(locale);
}

/** aparté's own words in the language of the interface: at start, and when the person changes it. */
export function setAparteLocale(locale: Locale): void {
  if (locale === 'fr') aparteGlobalConfig.setLocale(fr);
  else aparteGlobalConfig.resetLocale();
}
