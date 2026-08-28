/**
 * The chrome's few glyphs, as vectors.
 *
 * A `+` written as a character took on the button's font size: in the
 * flank, at 12 px, that gave a tiny sign lost in its chip. A stroke fills
 * whatever box it's given, at every size, and it has the same thickness as
 * the interface's other strokes.
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

/** The three dots of an actions menu. */
export function DotsGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3.4" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12.6" cy="8" r="1.15" fill="currentColor" />
    </svg>
  );
}
