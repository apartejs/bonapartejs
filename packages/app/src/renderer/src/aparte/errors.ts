/**
 * The error of a reply, as aparté draws it (aparté 1.14, apartejs/aparte#265): its icon, its heading, the sentence
 * its code reads as, its details — but a reply the engine cut says so in the app's words. The code the core ended
 * the run with (`engine-died`, a `run-error` line) is saved with the reply as `appCode`: after a reload the reply
 * still says what happened, where the card above the composer lives only while the window does. A renderer cannot
 * hand an error back to aparté's own card, so that card is drawn again here, its classes copied (apartejs/aparte#267).
 */

import { aparteGlobalConfig, type AparteErrorRenderer } from '@aparte/core';

type ErrorContext = Parameters<AparteErrorRenderer>[0];

export interface ErrorWords {
  /** aparté's heading of an error, in the language of the interface. */
  title: string;
  /** aparté's error icon, an SVG of its own set. */
  icon: string;
  /** What a reply the engine cut says. */
  engineDied: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function errorCard(error: ErrorContext, words: ErrorWords): string {
  const said = error.appCode === 'engine-died' ? words.engineDied : (error.sentence ?? error.message);
  const code = error.code ? ` data-error-code="${escapeHtml(error.code)}"` : '';
  const appCode = error.appCode ? ` data-app-code="${escapeHtml(error.appCode)}"` : '';
  const details = error.details ? `<pre class="aparte-segment-error__details">${escapeHtml(error.details)}</pre>` : '';
  // The icon is aparté's own constant SVG, nothing a person or a model wrote.
  return `<div class="aparte-segment aparte-alert aparte-alert--danger aparte-segment-error"${code}${appCode}><span class="aparte-alert__icon">${words.icon}</span><div class="aparte-alert__body"><div class="aparte-alert__title">${escapeHtml(words.title)}</div><div class="aparte-alert__message">${escapeHtml(said)}</div>${details}</div></div>`;
}

/** Installed with aparté's locale: the card is drawn in the language it was drawn in, as aparté's own custom cards. */
export function setupErrorCard(engineDied: string): void {
  aparteGlobalConfig.setErrorRenderer((error) =>
    errorCard(error, { title: aparteGlobalConfig.t('error'), icon: aparteGlobalConfig.getIcon('error') || '⚠', engineDied }),
  );
}
