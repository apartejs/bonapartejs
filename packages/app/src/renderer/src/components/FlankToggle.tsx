import { Button, cn } from '@aparte/bonaparte-plugin-sdk/ui';

interface FlankToggleProps {
  /** Which flank: the glyph is the same, flipped. */
  side: 'start' | 'end';
  collapsed: boolean;
  label: string;
  shortcut: string;
  onToggle: () => void;
}

/**
 * Toggle for a flank — ONE icon, two states.
 *
 * The old version swapped glyphs depending on the state (`▊ ` then `▎▊`):
 * two drawings for a single button, so nothing for the eye to latch onto.
 * Codex does the opposite, and that's what Paul noticed: "it looks like it's
 * the same icon." It IS a single one; only its FILL says whether the flank
 * is open. The button itself never moves from the end of the bar.
 *
 * The glyph is the now-conventional pictogram (VS Code, Codex, Linear): a
 * frame with a third filled in on the relevant side. Using `start`/`end`
 * logic rather than left/right — in RTL, the conversations flank changes
 * side, not role.
 */
export function FlankToggle({
  side,
  collapsed,
  label,
  shortcut,
  onToggle,
}: FlankToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'flank-toggle size-7 shrink-0 self-center rounded-lg text-muted-foreground hover:text-foreground',
        !collapsed && 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
        // The left flank is the same drawing, flipped: only one path to maintain.
        side === 'start' && '[&_svg]:-scale-x-100',
      )}
      onClick={onToggle}
      aria-pressed={!collapsed}
      aria-label={label}
      title={`${label} (${shortcut})`}
    >
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" focusable="false">
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
        {/* The seam line and the filled block are always in the DOM: it's
            the opacity that speaks, which is what makes the transition
            possible. */}
        <line
          x1="10.4"
          y1="2.6"
          x2="10.4"
          y2="13.4"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path
          className={cn(
            'flank-fill fill-current transition-opacity duration-(--bp-base) ease-(--bp-ease)',
            collapsed ? 'opacity-0' : 'opacity-85',
          )}
          d="M10.4 2.6h1.6a2.4 2.4 0 0 1 2.4 2.4v6a2.4 2.4 0 0 1-2.4 2.4h-1.6z"
        />
      </svg>
    </Button>
  );
}
