import { describe, expect, it } from 'vitest';
import { getSegmentRenderer } from '@aparte/core';
import { bootstrapAparte } from './aparte-bootstrap.js';

/** Les types de segments que notre boucle émet réellement (ChatScreen). */
const EMITTED = ['text', 'thinking', 'tool_call', 'error'] as const;

describe('bootstrap aparté', () => {
  it('enregistre les renderers des segments qu’on émet', () => {
    // La lib n'enregistre ses renderers par défaut que dans le constructeur
    // d'`AparteClient` — que bonaparte n'instancie JAMAIS (invariant : pas de
    // seconde boucle côté renderer). Sans appel explicite, chaque segment
    // s'affiche « [Unknown segment type: …] » et la réponse du modèle
    // disparaît de l'écran.
    bootstrapAparte();

    for (const type of EMITTED) {
      expect(getSegmentRenderer(type), `renderer manquant : ${type}`).toBeDefined();
    }
  });
});
