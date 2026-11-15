/**
 * The pieces of a settings page (board « Réglages · Général »): a section
 * card, a row — its label and description on the left, its control on the
 * right —, a switch, a choice among a few values. Native controls in the
 * kit's classes, so they keep their keyboard (`.aparte-switch`); the kit has
 * no segmented choice of a value (apartejs/aparte#225): native radios in its
 * segmented track.
 */

import { useId, type ReactNode } from 'react';

/** A card of settings; `single`: one setting, whose row says it — no title above it (board). */
export function Section({ title, hint, single, children }: { title: string; hint?: string; single?: boolean; children: ReactNode }) {
  return (
    <section className="setting-section" aria-label={title}>
      {single ? null : <h2 className="setting-section__title">{title}</h2>}
      {hint ? <p className="setting-section__hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Row({ label, hint, control, id }: { label: string; hint?: string; control: ReactNode; id?: string }) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <span className="setting-row__label" id={id}>
          {label}
        </span>
        {hint ? <span className="setting-row__hint">{hint}</span> : null}
      </div>
      <div className="setting-row__control">{control}</div>
    </div>
  );
}

export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(next: boolean): void }) {
  const id = useId();
  return (
    <Row
      label={label}
      {...(hint ? { hint } : {})}
      id={id}
      control={
        <input
          type="checkbox"
          role="switch"
          className="aparte-switch aparte-switch--primary"
          aria-labelledby={id}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
    />
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** A choice among a few values: radios in the kit's segmented track. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  small,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange(next: T): void;
  small?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={`aparte-tabs aparte-tabs--segmented setting-choice${small ? ' setting-choice--small' : ''}`}>
      {options.map((option) => (
        <label key={option.value} className="aparte-tabs__tab setting-choice__option">
          <input
            type="radio"
            className="setting-radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
