/**
 * aparté's own words, said the way bonaparte speaks: aparté's French says
 * « vous », bonaparte says « tu », and the boards name some things their own
 * way (« Laisse-le choisir » for a question's skip, « Attend ta réponse »).
 * Laid over aparté's locale; set again when the language changes.
 */

import { aparteGlobalConfig, type AparteConfig } from '@aparte/core';
import type { Messages } from '../i18n/index';

export function speakAsBonaparte(messages: Messages, config: AparteConfig = aparteGlobalConfig): void {
  config.extendLocale(messages.aparteWords);
}
