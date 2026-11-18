/**
 * One failure, as the board « Quand quelque chose casse » draws each (task 12.3): when it happened, what happened,
 * what is safe and what is lost, and what can be done — the first action the one the board puts first. Never a
 * blank page, never « erreur inconnue ». The kit's alert, its tone the failure's; the tone is never the only word.
 */

import type { ReactNode } from 'react';

export interface FailureAction {
  label: string;
  run(): void;
  /** The board's three weights: the way forward, another, a way out. */
  weight?: 'primary' | 'secondary' | 'tertiary';
  disabled?: boolean;
  busy?: boolean;
}

export interface FailureCardProps {
  /** When it happened: « Avant de charger », « Pendant une réponse »… */
  context: string;
  title: string;
  headline: string;
  detail?: string;
  safe?: string;
  lost?: string;
  /** The words before what is safe and what is lost: « Sauf : », « Perdu : ». */
  safeLabel?: string;
  lostLabel?: string;
  tone: 'warning' | 'error' | 'neutral';
  actions: FailureAction[];
  children?: ReactNode;
  className?: string;
}

const WEIGHT = {
  primary: 'aparte-btn aparte-btn--primary aparte-btn--solid',
  secondary: 'aparte-btn aparte-btn--outline',
  tertiary: 'aparte-btn aparte-btn--ghost',
} as const;

export function FailureCard(props: FailureCardProps) {
  const tone = props.tone === 'neutral' ? '' : props.tone === 'error' ? ' aparte-alert--error' : ' aparte-alert--warning';
  return (
    <div className={`aparte-alert${tone} failure-card${props.className ? ` ${props.className}` : ''}`} role="alert" data-failure={props.title}>
      <div className="aparte-alert__body">
        <p className="failure-card__context">{props.context}</p>
        <p className="aparte-alert__title failure-card__title">{props.title}</p>
        <p className="failure-card__headline">{props.headline}</p>
        {props.detail ? <p className="aparte-alert__message">{props.detail}</p> : null}
        {props.safe || props.lost ? (
          <ul className="failure-card__list">
            {props.safe ? (
              <li>
                <strong>{props.safeLabel}</strong> {props.safe}
              </li>
            ) : null}
            {props.lost ? (
              <li>
                <strong>{props.lostLabel}</strong> {props.lost}
              </li>
            ) : null}
          </ul>
        ) : null}
        {props.children}
        {props.actions.length > 0 ? (
          <div className="failure-card__actions">
            {props.actions.map((action, index) => (
              <button
                key={action.label}
                type="button"
                className={WEIGHT[action.weight ?? (index === 0 ? 'primary' : 'secondary')]}
                disabled={action.disabled || action.busy}
                aria-busy={action.busy}
                onClick={action.run}
              >
                {action.busy ? <span className="aparte-spinner" aria-hidden="true" /> : null}
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
