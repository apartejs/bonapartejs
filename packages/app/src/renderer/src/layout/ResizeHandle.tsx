import { useCallback, useRef } from 'react';
import type { LayoutBounds } from './use-layout.js';

interface ResizeHandleProps {
  /** Largeur courante du panneau que cette poignée redimensionne. */
  width: number;
  bounds: LayoutBounds;
  /** Bord du panneau où la poignée se pose : `end` = à droite, `start` = à gauche. */
  side: 'end' | 'start';
  label: string;
  onResize: (width: number) => void;
}

/** Pas au clavier : fin par défaut, franc avec Maj. */
const STEP = 16;
const BIG_STEP = 64;

/**
 * Séparateur redimensionnable entre deux zones du shell.
 *
 * Il est positionné en ABSOLU, à cheval sur la bordure du panneau, et
 * n'occupe donc AUCUNE place dans la mise en page — c'est ainsi que font
 * VS Code, Slack ou Linear. Une gouttière permanente de quelques pixels se
 * voit, décale tout, et se paie sur chaque écran alors qu'elle ne sert qu'au
 * moment du survol.
 *
 * Il reste large de 8 px pour la SAISIE tout en ne peignant qu'un filet de
 * 1 px au survol : une cible de 1 px se rate, et se rater sur un séparateur
 * donne l'impression que l'interface ne répond pas.
 *
 * Utilisable au clavier, parce qu'une poignée réservée à la souris exclut du
 * monde et rend la disposition irrattrapable dès qu'un panneau est tiré trop
 * loin.
 *
 * `setPointerCapture` plutôt qu'un écouteur sur `window` : le glissement suit
 * le pointeur même hors de la fenêtre, et s'arrête proprement si le navigateur
 * l'annule.
 */
export function ResizeHandle({
  width,
  bounds,
  side,
  label,
  onResize,
}: ResizeHandleProps) {
  const origin = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Bouton principal seulement : un clic droit ne redimensionne pas.
      if (event.button !== 0) return;
      origin.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing');
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = origin.current;
      if (!start) return;
      const delta = event.clientX - start.x;
      onResize(start.width + (side === 'end' ? delta : -delta));
    },
    [onResize, side],
  );

  const stop = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = null;
    document.body.classList.remove('resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? BIG_STEP : STEP;
      // Les flèches suivent l'ÉCRAN, pas le panneau : « droite » élargit ce qui
      // est à gauche et rétrécit ce qui est à droite. C'est ce que la main
      // attend en regardant le séparateur bouger.
      const towardsEnd = event.key === 'ArrowRight';
      const towardsStart = event.key === 'ArrowLeft';
      if (!towardsEnd && !towardsStart) {
        if (event.key === 'Home') onResize(bounds.min);
        else if (event.key === 'End') onResize(bounds.max);
        else if (event.key === 'Enter' || event.key === ' ') onResize(bounds.default);
        else return;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const direction = towardsEnd ? 1 : -1;
      onResize(width + direction * step * (side === 'end' ? 1 : -1));
    },
    [bounds, onResize, side, width],
  );

  return (
    <div
      className={`resize-handle resize-handle-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(bounds.default)}
      title={label}
    />
  );
}
