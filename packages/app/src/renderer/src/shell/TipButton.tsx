/**
 * An icon button with its name: the accessible name, and the same words shown
 * beside it on hover and on keyboard focus — aparté's kit tooltip, shown by
 * the kit itself (`.aparte-tooltip-anchor--hover`).
 */

import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export interface TipButtonProps {
  label: string;
  /** The words shown on hover, when they say more than the name (a shortcut). */
  tip?: string;
  icon: IconName;
  /** Where the tooltip shows: beside the button (the folded sidebar), or under it. */
  side?: 'end' | 'bottom';
  className?: string;
  /** A mark on the button's corner (a conversation that waits). */
  badge?: ReactNode;
  current?: boolean;
  /** A toggle: whether what it opens is open. */
  pressed?: boolean;
  onClick(): void;
}

export function TipButton({ label, tip, icon, side = 'bottom', className, badge, current, pressed, onClick }: TipButtonProps) {
  return (
    <span className="aparte-tooltip-anchor aparte-tooltip-anchor--hover bonaparte-tip" data-side={side}>
      <button
        type="button"
        className={`aparte-btn aparte-btn--icon aparte-btn--ghost bonaparte-icon-button${className ? ` ${className}` : ''}`}
        aria-label={label}
        {...(current ? { 'aria-current': 'page' as const } : {})}
        {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
        onClick={onClick}
      >
        <Icon name={icon} />
        {badge}
      </button>
      <span className="aparte-tooltip" aria-hidden="true">
        {tip ?? label}
      </span>
    </span>
  );
}
