/**
 * The error of a reply (aparté 1.14, apartejs/aparte#265): aparté's own card, but a reply the engine cut says so in
 * the app's words — the code the core ended the run with (`engine-died`) is saved with the reply, so it still says
 * it after a reload.
 */

import { describe, expect, it } from 'vitest';
import { errorCard } from './errors.js';

const WORDS = { title: 'Erreur', icon: '<svg class="i"></svg>', engineDied: 'Le moteur s’est arrêté pendant cette réponse.' };

describe('the error card of a reply', () => {
  it('a reply the engine cut says it in the app’s words, whatever aparté’s sentence', () => {
    const card = errorCard({ message: 'llama-server exited', sentence: 'Le service a renvoyé une erreur.', code: 'PROVIDER_ERROR', appCode: 'engine-died' }, WORDS);
    expect(card).toContain('Le moteur s’est arrêté pendant cette réponse.');
    expect(card).not.toContain('Le service a renvoyé une erreur.');
    expect(card).toContain('data-app-code="engine-died"');
  });

  it('any other error is aparté’s card as it is: its icon, its heading, its sentence, its details', () => {
    const card = errorCard({ message: 'raw', sentence: 'Trop de requêtes.', code: 'USAGE_RATE_LIMIT', details: 'retry in 3 s' }, WORDS);
    expect(card).toContain('aparte-alert aparte-alert--danger aparte-segment-error');
    expect(card).toContain('<svg class="i"></svg>');
    expect(card).toContain('<div class="aparte-alert__title">Erreur</div>');
    expect(card).toContain('Trop de requêtes.');
    expect(card).toContain('retry in 3 s');
    expect(card).toContain('data-error-code="USAGE_RATE_LIMIT"');
  });

  it('an error that keeps its own words shows them, escaped', () => {
    const card = errorCard({ message: 'bad <b>input</b>' }, WORDS);
    expect(card).toContain('bad &lt;b&gt;input&lt;/b&gt;');
    expect(card).not.toContain('<b>');
  });
});
