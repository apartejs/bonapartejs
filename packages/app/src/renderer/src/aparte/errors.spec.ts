/**
 * The error of a reply (aparté 1.14 and 1.15, apartejs/aparte#265 and #267): a reply the engine cut says so in the
 * app's words — the code the core ended the run with (`engine-died`) is saved with the reply, so it still says it
 * after a reload; every other error is aparté's own card, translated on a language switch.
 */

import { describe, expect, it } from 'vitest';
import { errorCard } from './errors.js';

const WORDS = { title: 'Erreur', icon: '<svg class="i"></svg>', engineDied: 'Le moteur s’est arrêté pendant cette réponse.' };

describe('the error card of a reply', () => {
  it('a reply the engine cut says it in the app’s words, in aparté’s card', () => {
    const card = errorCard({ message: 'llama-server exited', sentence: 'Le service a renvoyé une erreur.', code: 'PROVIDER_ERROR', appCode: 'engine-died' }, WORDS);
    expect(card).toContain('Le moteur s’est arrêté pendant cette réponse.');
    expect(card).not.toContain('Le service a renvoyé une erreur.');
    expect(card).toContain('data-app-code="engine-died"');
    expect(card).toContain('aparte-alert aparte-alert--danger aparte-segment-error');
    expect(card).toContain('<div class="aparte-alert__title">Erreur</div>');
  });

  it('any other error is handed back to aparté: its own card, which a language switch rewrites (aparté 1.15)', () => {
    expect(errorCard({ message: 'raw', sentence: 'Trop de requêtes.', code: 'USAGE_RATE_LIMIT', details: 'retry in 3 s' }, WORDS)).toBeNull();
    expect(errorCard({ message: 'bad <b>input</b>' }, WORDS)).toBeNull();
    expect(errorCard({ message: 'x', code: 'PROVIDER_ERROR', appCode: 'something-else' }, WORDS)).toBeNull();
  });

  it('the details of a cut reply are shown escaped', () => {
    const card = errorCard({ message: 'x', appCode: 'engine-died', details: 'exit <3>' }, WORDS);
    expect(card).toContain('exit &lt;3&gt;');
  });
});
