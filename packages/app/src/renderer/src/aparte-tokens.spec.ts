import libraryStylesheet from '@aparte/core/styles.css?raw';
import { describe, expect, it } from 'vitest';

/**
 * Tout jeton `--aparte-*` que NOTRE feuille lit doit exister dans celle de la lib.
 *
 * Le défaut que ce test empêche est silencieux de bout en bout. `color:
 * var(--aparte-text-primary)` sur un jeton non déclaré ne produit ni erreur, ni
 * avertissement : la déclaration devient invalide au moment du calcul, la
 * propriété est simplement héritée, et le rendu reste presque juste. Nous avons
 * porté ce nom-là — qui n'a jamais existé — à dix endroits pendant des mois, à
 * travers plusieurs relectures visuelles.
 *
 * Les feuilles sont lues par le BUNDLER (`?raw`), pas par `node:fs` : c'est sa
 * résolution qui fait autorité, la même que celle du renderer, y compris pour
 * le point d'entrée `./styles.css` de la lib — dont le chemin interne ne nous
 * regarde pas et peut changer.
 */

const ourStylesheets = import.meta.glob<string>('./*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Les jetons lus SANS repli — les seuls qui exigent une déclaration. */
function tokensReadWithoutFallback(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--aparte-[a-z0-9-]+)\s*\)/g)].map((m) => m[1] as string);
}

/** Les jetons lus AVEC un repli — suspects dans l'autre sens (voir plus bas). */
function tokensReadWithFallback(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--aparte-[a-z0-9-]+)\s*,/g)].map((m) => m[1] as string);
}

function tokensDeclared(css: string): Set<string> {
  return new Set([...css.matchAll(/(--aparte-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
}

describe('jetons de thème lus par bonaparte', () => {
  const declared = tokensDeclared(libraryStylesheet);
  const sheets = Object.entries(ourStylesheets);

  it('les deux feuilles sont bien celles qu’on croit', () => {
    // Ancres : sans elles, une feuille vide ferait passer les deux tests
    // suivants à vide — exactement le mode d'échec que ce fichier existe pour
    // rendre impossible.
    expect(declared.size).toBeGreaterThan(100);
    expect(declared.has('--aparte-text')).toBe(true);
    expect(sheets.length).toBeGreaterThan(2);
  });

  it('chaque jeton lu sans repli est déclaré par la lib', () => {
    const missing = sheets.flatMap(([file, css]) =>
      tokensReadWithoutFallback(css)
        .filter((token) => !declared.has(token))
        .map((token) => `${file} lit ${token}, que la lib ne déclare pas`),
    );

    expect([...new Set(missing)]).toEqual([]);
  });

  it('aucun repli sur un jeton que la lib déclare', () => {
    // Un repli ne s'applique QUE si le jeton est absent. Sur un jeton déclaré,
    // il ne sert donc jamais — il ne fait que vivre à côté, et diverger : nous
    // portions `var(--aparte-error, #c0392b)`, soit un second rouge en réserve
    // qui n'aurait pris la main que le jour où la lib aurait retiré le sien.
    // C'est le ménage que la lib s'est fait à elle-même en 0.13.0 (471 replis
    // retirés, dont 155 contredisaient la valeur déclarée).
    const useless = sheets.flatMap(([file, css]) =>
      tokensReadWithFallback(css)
        .filter((token) => declared.has(token))
        .map((token) => `${file} met un repli sur ${token}, que la lib déclare`),
    );

    expect([...new Set(useless)]).toEqual([]);
  });
});
