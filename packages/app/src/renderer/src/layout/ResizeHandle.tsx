import { useCallback, useRef } from 'react';
import type { LayoutBounds } from './use-layout.js';

interface ResizeHandleProps {
  /** Largeur courante du panneau que cette poignée redimensionne. */
  width: number;
  bounds: LayoutBounds;
  /** `end` = la poignée est à DROITE du panneau (flanc gauche), et inversement. */
  side: 'end' | 'start';
  label: string;
  onResize: (width: number) => void;
}

/** Pas au clavier : fin par défaut, franc avec Maj. */
const STEP = 16;
const BIG_STEP = 64;

/**
 * Poignée de redimensionnement entre deux zones du shell.
 *
 * Elle est utilisable à la SOURIS et au CLAVIER. Une poignée qui n'existe qu'à
 * la souris exclut une partie des gens et rend la disposition irrattrapable
 * dès qu'un panneau est tiré trop loin — c'est le plancher de qualité, pas une
 * option.
 *
 * `setPointerCapture` plutôt qu'un écouteur sur `window` : le glissement suit
 * le pointeur même quand il sort de la fenêtre ou passe au-dessus d'un iframe,
 * et il s'arrête proprement si le navigateur l'annule.
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
      // Pendant le glissement, empêcher la sélection de texte : sans ça, tirer
      // la poignée surligne la moitié de l'interface.
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
      // attend en regardant la poignée bouger.
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
      className="resize-handle"
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
