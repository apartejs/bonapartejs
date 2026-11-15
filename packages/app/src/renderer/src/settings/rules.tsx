/**
 * Two pieces the pages « Permissions » and « Projet » share: the four modes
 * as cards (the kit's `.aparte-field-choice`), and the
 * list of what is always asked — the files that run later, fixed, and the
 * ones the person adds, each with its « Retirer ».
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import { useState } from 'react';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

const MODES: PlayMode[] = ['lecture', 'repetition', 'plume', 'impro'];

export function ModeCards({
  messages,
  label,
  name,
  value,
  onChange,
}: {
  messages: Messages;
  label: string;
  name: string;
  value: PlayMode;
  onChange(mode: PlayMode): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mode-cards">
      {MODES.map((mode) => (
        <label key={mode} className={`aparte-field-choice aparte-field-choice--boxed mode-card${value === mode ? ' aparte-field-choice--selected' : ''}`}>
          <input type="radio" className="aparte-radio aparte-radio--primary" name={name} checked={value === mode} onChange={() => onChange(mode)} />
          <span className="aparte-field-choice__body">
            <strong>{messages.modes[mode]}</strong>
            <span className="aparte-field-hint">{messages.settings.permissions.modeNotes[mode]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function AlwaysAsked({
  messages,
  builtins,
  added,
  onChange,
}: {
  messages: Messages;
  builtins: readonly string[];
  added: readonly string[];
  onChange(next: string[]): void;
}) {
  const words = messages.settings.permissions;
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const name = draft.trim();
    if (!name || added.includes(name)) return;
    onChange([...added, name]);
    setDraft('');
  };
  return (
    <>
      <ul className="asked-pills" aria-label={words.alwaysAsk}>
        {builtins.map((name) => (
          <li key={name} className="asked-pill">
            {name}
          </li>
        ))}
        {added.map((name) => (
          <li key={name} className="asked-pill asked-pill--added">
            {name}
            <button
              type="button"
              className="asked-pill__remove"
              aria-label={words.remove(name)}
              onClick={() => onChange(added.filter((one) => one !== name))}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <div className="setting-actions">
        <input
          className="aparte-field asked-field"
          aria-label={words.addFileField}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <button type="button" className="aparte-btn aparte-btn--outline" disabled={draft.trim() === ''} onClick={add}>
          {words.add}
        </button>
      </div>
    </>
  );
}
