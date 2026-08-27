import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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
 * Un `var()` avec repli (`var(--x, 12px)`) est légitime et n'est pas contrôlé :
 * la lib laisse dix-huit jetons délibérément non déclarés, où le repli EST le
 * propriétaire de la valeur.
 */

const require_ = createRequire(import.meta.url);
const STYLES = join(import.meta.dirname);

/**
 * La feuille publiée par la lib, résolue par son point d'entrée déclaré —
 * `./styles.css`, le même que le renderer importe. Résoudre un chemin interne
 * (`dist/index.css`) marcherait aujourd'hui et casserait le jour où la lib
 * réorganise son `dist`, ce qu'elle a le droit de faire.
 */
function libraryStylesheet(): string {
  return readFileSync(require_.resolve('@aparte/core/styles.css'), 'utf8');
}

function ourStylesheets(): { file: string; css: string }[] {
  return readdirSync(STYLES)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ file: name, css: readFileSync(join(STYLES, name), 'utf8') }));
}

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
  const declared = tokensDeclared(libraryStylesheet());

  it('la feuille de la lib est bien celle qu’on croit', () => {
    // Ancre : sans elle, une feuille vide ferait passer le test suivant à vide.
    expect(declared.size).toBeGreaterThan(100);
    expect(declared.has('--aparte-text')).toBe(true);
  });

  it('chaque jeton lu sans repli est déclaré par la lib', () => {
    const missing = ourStylesheets().flatMap(({ file, css }) =>
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
    const useless = ourStylesheets().flatMap(({ file, css }) =>
      tokensReadWithFallback(css)
        .filter((token) => declared.has(token))
        .map((token) => `${file} met un repli sur ${token}, que la lib déclare`),
    );

    expect([...new Set(useless)]).toEqual([]);
  });
});
