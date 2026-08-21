import { useEffect, useState } from 'react';

/** Durée du repli d'un flanc, en accord avec `--bp-slow` (app.css). */
export const COLLAPSE_MS = 420;

export interface CollapseTransition {
  /** Faut-il rendre l'élément ? Reste vrai le temps de la sortie. */
  mounted: boolean;
  /** L'élément est-il à sa taille pleine ? Pilote la largeur, donc l'animation. */
  entered: boolean;
}

/**
 * Garde un flanc MONTÉ pendant qu'il se replie, et le fait naître à zéro.
 *
 * Un flanc qu'on démonte sur-le-champ disparaît d'un seul coup : ça se lit
 * comme un défaut d'affichage, pas comme une action. En le gardant monté à
 * largeur décroissante, le contenu s'en va avec lui, et l'œil suit.
 *
 * On ne peut pas se contenter d'animer la largeur d'un élément toujours
 * monté : à zéro, la vue d'un plugin resterait vivante — le terminal se
 * redimensionnerait à zéro colonne, et la page native du navigateur recevrait
 * un rectangle vide. Le démontage arrive donc APRÈS la transition.
 *
 * DEUX `requestAnimationFrame` à l'ouverture, et c'est tout le sujet : le
 * callback d'un rAF s'exécute AVANT la peinture de la frame en cours. Avec un
 * seul, l'élément naissait et recevait sa largeur finale dans la même frame —
 * le navigateur n'avait aucun état de départ à interpoler, donc aucune
 * transition, donc une ouverture instantanée. Le premier rAF laisse peindre la
 * largeur zéro, le second déclenche le trajet.
 */
export function useCollapseTransition(
  open: boolean,
  duration = COLLAPSE_MS,
): CollapseTransition {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setEntered(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return { mounted, entered };
}
