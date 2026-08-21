import { useEffect, useState } from 'react';

/** Durée du repli d'un flanc, en accord avec `--bp-slow` (app.css). */
export const COLLAPSE_MS = 380;

export interface CollapseTransition {
  /** Faut-il rendre l'élément ? Reste vrai le temps de la sortie. */
  mounted: boolean;
  /** L'élément est-il à sa taille pleine ? Pilote la largeur, donc l'animation. */
  entered: boolean;
}

/**
 * Garde un flanc MONTÉ pendant qu'il se replie.
 *
 * Un flanc qu'on démonte sur-le-champ disparaît d'un seul coup : ça se lit
 * comme un défaut d'affichage, pas comme une action. En le gardant monté à
 * largeur décroissante, le contenu s'en va avec lui, et l'œil suit.
 *
 * On ne peut pas se contenter d'animer la largeur d'un élément toujours
 * monté : à zéro, la vue d'un plugin resterait vivante — le terminal se
 * redimensionnerait à zéro colonne, et la page native du navigateur recevrait
 * un rectangle vide. Le démontage arrive donc APRÈS la transition.
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
      // Une frame de décalage : sans elle, l'élément naît à sa largeur finale
      // et il n'y a aucune transition à jouer.
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return { mounted, entered };
}
