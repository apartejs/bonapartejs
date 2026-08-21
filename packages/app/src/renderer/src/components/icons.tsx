/**
 * Les quelques glyphes de la chrome, en vectoriel.
 *
 * Un `+` écrit en caractère prenait la taille de la police du bouton : dans le
 * flanc, à 12 px, ça donnait un signe minuscule perdu dans sa pastille. Un
 * tracé occupe la boîte qu'on lui donne, à toutes les tailles, et il a la même
 * épaisseur que les autres traits de l'interface.
 */

export function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 3.75v8.5M3.75 8h8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Les trois points d'un menu d'actions. */
export function DotsGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3.4" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12.6" cy="8" r="1.15" fill="currentColor" />
    </svg>
  );
}
