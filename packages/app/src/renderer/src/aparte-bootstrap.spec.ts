import { describe, expect, it } from 'vitest';
import {
  aparteGlobalConfig,
  getSegmentRenderer,
  isSegmentSettled,
  type AparteSegment,
} from '@aparte/core';
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

    const html = aparteGlobalConfig.renderMarkdown('**gras** et `code`');
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
    expect(aparteGlobalConfig.createStreamingMarkdownRenderer(target)).not.toBeNull();
  });

  it('installe la coloration syntaxique, de façon asynchrone', async () => {
    // Construire le highlighter est un `await`, tenu HORS du chemin de
    // premier rendu.
    await bootstrapHighlighting('dark');

    expect(aparteGlobalConfig.hasHighlightProvider()).toBe(true);
  });

  it('colorise les langages qu’on a choisi d’embarquer', async () => {
    await bootstrapHighlighting('dark');

    for (const lang of ['typescript', 'python', 'rust', 'bash', 'json']) {
      const html = await aparteGlobalConfig.highlightCode('const a = 1;', lang);
      expect(html, `pas de coloration pour ${lang}`).toContain('shiki');
    }
  });

  it('retombe en texte brut sur un langage absent, sans lever', async () => {
    // Contrepartie ASSUMÉE du bundle maîtrisé : nos grammaires sont figées.
    // Ce qui n'est pas embarqué ne doit pas casser l'affichage — un modèle
    // qui répond en Brainfuck reste lisible.
    await bootstrapHighlighting('dark');

    await expect(
      aparteGlobalConfig.highlightCode('++++[>++++<-]', 'brainfuck'),
    ).resolves.toBeTypeOf('string');
  });

  it('suit le thème de l’app sans reconstruire le highlighter', async () => {
    // Le HTML produit par shiki fige les couleurs : sans ré-enregistrement,
    // un thème clair garderait du code sur fond sombre.
    await bootstrapHighlighting('light');
    const light = await aparteGlobalConfig.highlightCode('const a = 1;', 'typescript');

    await bootstrapHighlighting('dark');
    const dark = await aparteGlobalConfig.highlightCode('const a = 1;', 'typescript');

    expect(light).toContain('github-light');
    expect(dark).toContain('github-dark');
  });
});

/**
 * Deux règles de la lib dont ChatScreen dépend DIRECTEMENT, et qui ont changé
 * sans que rien ne casse : la compilation passait, les tests passaient, et le
 * comportement était faux à l'écran. Elles sont épinglées ici pour que le
 * prochain changement de contrat se voie en rouge plutôt qu'en production.
 */
describe('contrat de la lib dont dépend la boucle', () => {
  it('un segment sans `isStreaming` n’est PAS considéré comme fini', () => {
    // C'est pour ça que `finish()` appelle `updateMessage(id, { status })` :
    // c'est le seul geste qui referme les segments du tour. Sans lui, la lib
    // les tient pour toujours en cours — pas de dernier passage du Markdown,
    // pas de coloration de la dernière ligne de code.
    const open = { id: 's1', type: 'text', content: 'bonjour' } as AparteSegment;

    expect(isSegmentSettled(open)).toBe(false);
    expect(isSegmentSettled({ ...open, isStreaming: false })).toBe(true);
  });

  it('un raisonnement sans `collapsed` est REPLIÉ', () => {
    // Depuis 0.10.0, l'absence vaut fermé (avant, elle valait ouvert). Notre
    // segment de réflexion doit donc dire `collapsed: false` explicitement,
    // sinon le modèle réfléchit une minute derrière un bloc fermé — l'écran
    // vide qu'on voulait précisément éviter.
    bootstrapAparte();
    const renderer = getSegmentRenderer('thinking');
    const render = (segment: AparteSegment): string => {
      const out = renderer?.render(segment);
      return typeof out === 'string' ? out : (out?.outerHTML ?? '');
    };
    const base = { id: 's2', type: 'thinking', content: 'hmm' } as AparteSegment;

    expect(render(base)).not.toContain('open');
    expect(render({ ...base, collapsed: false } as AparteSegment)).toContain('open');
  });
});
