/**
 * The error of a reply: a reply the engine cut says so in the app's words. The code the core ended the run with
 * (`engine-died`, a `run-error` line) is saved with the reply as `appCode` (aparté 1.14, apartejs/aparte#265):
 * after a reload the reply still says what happened, where the card above the composer lives only while the
 * window does. Every other error is handed back to aparté — its own card, translated on a language switch
 * (aparté 1.15, apartejs/aparte#267).
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

/** The card of a reply the engine cut, in aparté's own classes; null for any other error: aparté draws it. */
export function errorCard(error: ErrorContext, words: ErrorWords): string | null {
  if (error.appCode !== 'engine-died') return null;
  const code = error.code ? ` data-error-code="${escapeHtml(error.code)}"` : '';
  const details = error.details ? `<pre class="aparte-segment-error__details">${escapeHtml(error.details)}</pre>` : '';
  // The icon is aparté's own constant SVG, nothing a person or a model wrote.
  return `<div class="aparte-segment aparte-alert aparte-alert--danger aparte-segment-error"${code} data-app-code="engine-died"><span class="aparte-alert__icon">${words.icon}</span><div class="aparte-alert__body"><div class="aparte-alert__title">${escapeHtml(words.title)}</div><div class="aparte-alert__message">${escapeHtml(words.engineDied)}</div>${details}</div></div>`;
}

/** Installed with aparté's locale: the card of a cut reply is drawn in the language it was drawn in. */
export function setupErrorCard(engineDied: string): void {
  aparteGlobalConfig.setErrorRenderer((error) =>
    errorCard(error, { title: aparteGlobalConfig.t('error'), icon: aparteGlobalConfig.getIcon('error') || '⚠', engineDied }),
  );
}
