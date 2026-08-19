import { describe, expect, it } from 'vitest';
import { AparteConfig, getSegmentRenderer } from '@aparte/core';
import { bootstrapAparte, bootstrapHighlighting } from './aparte-bootstrap.js';

/** Les types de segments que notre boucle émet réellement (ChatScreen). */
const EMITTED = ['text', 'thinking', 'tool_call', 'error'] as const;

describe('bootstrap aparté', () => {
  it('enregistre les renderers des segments qu’on émet', () => {
    // Historique : la lib n'enregistrait ses renderers que dans le
    // constructeur d'`AparteClient` — que bonaparte n'instancie JAMAIS
    // (invariant : pas de seconde boucle côté renderer). Depuis 0.5.0-alpha.0
    // ils s'installent au premier segment ; on garde l'appel et ce test, parce
    // que le symptôme (« [Unknown segment type: …] ») était silencieux côté
    // produit : le chat marchait, seul le CONTENU disparaissait.
    bootstrapAparte();

    for (const type of EMITTED) {
      expect(getSegmentRenderer(type), `renderer manquant : ${type}`).toBeDefined();
    }
  });

  it('installe un moteur de rendu Markdown', () => {
    // Sans fournisseur, `renderMarkdown` rend la chaîne INCHANGÉE : le modèle
    // affiche ses astérisques et ses dièses en clair. Un agent de code qui
    // répond en Markdown brut est illisible.
    bootstrapAparte();

    const html = AparteConfig.renderMarkdown('**gras** et `code`');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>');
  });

  it('installe le rendu Markdown incrémental pour le streaming', () => {
    // Le fournisseur « one-shot » ne sert qu'aux messages finis. Sans le
    // fournisseur incrémental, chaque token re-parserait tout le message :
    // exactement ce qu'on ne peut pas se permettre sur un modèle local qui
    // débite pendant des minutes.
    bootstrapAparte();

    const target = {} as HTMLElement;
    expect(AparteConfig.createStreamingMarkdownRenderer(target)).not.toBeNull();
  });

  it('installe la coloration syntaxique, de façon asynchrone', async () => {
    // shiki charge ses grammaires à la demande : son installation est un
    // `await`, tenu HORS du chemin de premier rendu.
    await bootstrapHighlighting('dark');

    expect(AparteConfig.hasHighlightProvider()).toBe(true);
  });
});
