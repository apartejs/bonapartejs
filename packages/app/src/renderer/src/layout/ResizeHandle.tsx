import { useCallback, useRef } from 'react';
import type { LayoutBounds } from './use-layout.js';

interface ResizeHandleProps {
  /** Current width of the panel this handle resizes. */
  width: number;
  bounds: LayoutBounds;
  /** Edge of the panel the handle sits on: `end` = right, `start` = left. */
  side: 'end' | 'start';
  label: string;
  onResize: (width: number) => void;
}

/** Keyboard step: fine by default, coarse with Shift. */
const STEP = 16;
const BIG_STEP = 64;

/**
 * Resizable separator between two zones of the shell.
 *
 * It is positioned ABSOLUTELY, straddling the panel's border, and therefore
 * takes up NO room in the layout — this is how VS Code, Slack, and Linear
 * all do it. A permanent gutter a few pixels wide is visible, shifts
 * everything, and is paid for on every screen even though it's only useful
 * at the moment of hover.
 *
 * It stays 8 px wide for the HIT AREA while painting only a 1 px hairline on
 * hover: a 1 px target gets missed, and missing on a separator gives the
 * impression that the interface isn't responding.
 *
 * Usable from the keyboard, because a handle reserved for the mouse excludes
 * part of the world and makes the layout unrecoverable as soon as a panel is
 * dragged too far.
 *
 * `setPointerCapture` rather than a listener on `window`: the drag follows
 * the pointer even outside the window, and stops cleanly if the browser
 * cancels it.
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
      // Primary button only: a right click doesn't resize.
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
      // The arrows follow the SCREEN, not the panel: "right" widens whatever
      // is on the left and shrinks whatever is on the right. This is what
      // the hand expects while watching the separator move.
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
