/**
 * The mascot of bonaparte (task 12.2, board « Logo et ses états »): aparté's ('.') in brass under a bicorne in the
 * accent, whose cockade is its light. The face is text in Georgia, never an image; the bicorne is the board's path.
 * Its state is `data-state`, which `mascot.css` animates; its name says the state for whoever cannot see it.
 */

import './mascot.css';
import type { MascotState } from './mascot-state';

/** Each state's face: its eyes and its nose, between the brackets. */
const FACES: Record<MascotState, { eyes: string; nose: string }> = {
  idle: { eyes: "'", nose: '.' },
  thinking: { eyes: "'", nose: '.' },
  talking: { eyes: "'", nose: 'o' },
  reading: { eyes: "'", nose: '.' },
  waiting: { eyes: "'", nose: '.' },
  happy: { eyes: 'ˆ', nose: '.' },
  surprised: { eyes: '°', nose: '.' },
  error: { eyes: 'x', nose: '.' },
  sleeping: { eyes: '-', nose: '.' },
  wake: { eyes: "'", nose: 'o' },
};

/** The bicorne of the board (viewBox 0 0 120 100); under 24 px it alone stands for the mark. */
export const BICORNE = 'M6 48C22 44 30 13 60 12C90 13 98 44 114 48C96 51 80 55 60 55C40 55 24 51 6 48Z';
const BRAID = 'M15 46C29 41 36 19 60 18C84 19 91 41 105 46';
const OPEN = '(';
const CLOSE = ')';
const DOTS = '…';
const Z = 'z';

export function Mascot({ state, label, className }: { state: MascotState; label: string; className?: string }) {
  const face = FACES[state];
  return (
    <span className={`mascot${className ? ` ${className}` : ''}`} data-state={state} role="img" aria-label={label}>
      <span className="mascot__face" aria-hidden="true">
        <span>{OPEN}</span>
        <span className="mascot__features">
          <span className="mascot__eye">{face.eyes}</span>
          <span className="mascot__nose">{face.nose}</span>
          <span className="mascot__eye">{face.eyes}</span>
        </span>
        <span>{CLOSE}</span>
      </span>
      <svg className="mascot__hat" viewBox="0 0 120 100" aria-hidden="true">
        <path className="mascot__hat-body" d={BICORNE} />
        <path className="mascot__braid" d={BRAID} />
        <circle className="mascot__socket" cx="38" cy="33" r="6.5" />
        <g className="mascot__light">
          <circle className="mascot__cockade" cx="38" cy="33" r="6.5" />
          <circle className="mascot__core" cx="38" cy="33" r="2.4" />
        </g>
      </svg>
      <span className="mascot__dots" aria-hidden="true">
        {DOTS}
      </span>
      <span className="mascot__zz" aria-hidden="true">
        <span className="mascot__z">{Z}</span>
        <span className="mascot__z">{Z}</span>
        <span className="mascot__z">{Z}</span>
      </span>
    </span>
  );
}
