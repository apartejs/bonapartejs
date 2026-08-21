interface FlankToggleProps {
  /** Quel flanc : le glyphe est le même, retourné. */
  side: 'start' | 'end';
  collapsed: boolean;
  label: string;
  shortcut: string;
  onToggle: () => void;
}

/**
 * Bascule d'un flanc — UNE icône, deux états.
 *
 * L'ancienne version changeait de glyphe selon l'état (`▊ ` puis `▎▊`) : deux
 * dessins pour un seul bouton, donc rien à quoi l'œil s'accroche. Codex fait
 * l'inverse, et c'est ce que Paul a remarqué : « on dirait que c'est la même
 * icône ». C'en est une seule ; seul son REMPLISSAGE dit si le flanc est
 * ouvert. Le bouton, lui, ne bouge jamais de l'extrémité de la barre.
 *
 * Le glyphe est le pictogramme désormais conventionnel (VS Code, Codex,
 * Linear) : un cadre avec un tiers rempli du côté concerné. En logique
 * `start`/`end` plutôt que gauche/droite — en RTL, le flanc des conversations
 * change de bord, pas de rôle.
 */
export function FlankToggle({
  side,
  collapsed,
  label,
  shortcut,
  onToggle,
}: FlankToggleProps) {
  return (
    <button
      type="button"
      className={`flank-toggle flank-toggle-${side}`}
      onClick={onToggle}
      aria-pressed={!collapsed}
      aria-label={label}
      title={`${label} (${shortcut})`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect
          x="1.6"
          y="2.6"
          width="12.8"
          height="10.8"
          rx="2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        {/* Le refend et le pavé plein sont toujours dans le DOM : c'est
            l'opacité qui parle, donc la transition est possible. */}
        <line
          x1="10.4"
          y1="2.6"
          x2="10.4"
          y2="13.4"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path className="flank-fill" d="M10.4 2.6h1.6a2.4 2.4 0 0 1 2.4 2.4v6a2.4 2.4 0 0 1-2.4 2.4h-1.6z" />
      </svg>
    </button>
  );
}
