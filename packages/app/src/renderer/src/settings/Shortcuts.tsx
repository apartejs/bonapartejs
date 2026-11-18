/**
 * Réglages · Raccourcis (task 12.1, board « Réglages · Raccourcis »): the shortcuts by group, each row its keys in
 * the kit's `<kbd>`; a click on a row waits for new keys (« Appuie sur la nouvelle touche… »), Escape lets go, keys
 * another action holds are refused and said. The keys aparté's composer and the approval card own are shown, and
 * not changed here (apartejs/aparte#263, apartejs/aparte#264).
 */

import { useEffect, useState } from 'react';
import type { Messages } from '../i18n/index';
import { bindingsOf, comboOf, conflictOf, keysOf, SHORTCUTS, type ShortcutAction, type ShortcutGroup } from '../shortcuts/registry';
import { CAPTURING } from '../shortcuts/useShortcuts';
import { Section } from './controls';
import type { PageProps } from './SettingsView';

type Kept = Record<string, string>;

const keptOf = (value: unknown): Kept => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Kept) : {});

/** Keys in the kit's `<kbd>`, a choice between two shown with « · ». */
function Keys({ choices, words }: { choices: string[][]; words: Messages['settings']['shortcuts'] }) {
  return (
    <span className="shortcut-row__keys">
      {choices.map((keys, index) => (
        <span key={keys.join('+') || index} className="shortcut-row__choice">
          {index > 0 ? <span className="shortcut-row__or">{words.or}</span> : null}
          {keys.length === 0 ? <span className="shortcut-row__none">{words.none}</span> : keys.map((one) => <kbd key={one} className="aparte-kbd">{one}</kbd>)}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsPage({ messages, values, change }: PageProps) {
  const words = messages.settings.shortcuts;
  const kept = keptOf(values['shortcuts']);
  const bindings = bindingsOf(kept);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [refused, setRefused] = useState<{ action: ShortcutAction; other: ShortcutAction } | null>(null);
  const [query, setQuery] = useState('');

  // While a row waits for keys, nothing else of the app runs on them.
  useEffect(() => {
    if (!capturing) return;
    document.body.dataset[CAPTURING] = '';
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        setCapturing(null);
        return;
      }
      const combo = comboOf(event);
      if (!combo) return;
      const other = conflictOf(bindings, capturing, combo);
      setCapturing(null);
      if (other) {
        setRefused({ action: capturing, other });
        return;
      }
      setRefused(null);
      change('shortcuts', { ...kept, [capturing]: combo });
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      delete document.body.dataset[CAPTURING];
    };
  }, [capturing, bindings, kept, change]);

  const needle = query.trim().toLowerCase();
  const matches = (label: string): boolean => !needle || label.toLowerCase().includes(needle);
  const fixed: Record<ShortcutGroup, { label: string; choices: string[][] }[]> = {
    conversations: [],
    agent: [
      { label: words.fixed.send, choices: [[words.keys['Enter']!], [words.keys['Shift']!, words.keys['Enter']!]] },
      { label: words.fixed.approve, choices: [[words.keys['Enter']!], [words.keys['Escape']!]] },
      { label: words.fixed.stop, choices: [[words.keys['Escape']!]] },
    ],
    panes: [],
  };
  const groups: ShortcutGroup[] = ['conversations', 'agent', 'panes'];
  const shown = groups.map((group) => ({
    group,
    rows: SHORTCUTS.filter((one) => one.group === group && matches(words.actions[one.id])),
    fixedRows: fixed[group].filter((one) => matches(one.label)),
  }));

  return (
    <div className="settings__sections shortcuts-page">
      <div className="shortcuts-page__head">
        <p className="settings__intro">{words.hint}</p>
        <input
          type="search"
          className="aparte-field shortcuts-page__search"
          placeholder={words.search}
          aria-label={words.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {shown.every((one) => one.rows.length === 0 && one.fixedRows.length === 0) ? <p className="setting-section__hint">{words.noMatch}</p> : null}
      {shown.map(({ group, rows, fixedRows }) =>
        rows.length === 0 && fixedRows.length === 0 ? null : (
          <Section key={group} title={words.groups[group]}>
            <ul className="shortcut-list">
              {rows.map((one) => {
                const label = words.actions[one.id];
                const waiting = capturing === one.id;
                return (
                  <li key={one.id} className={`shortcut-row${waiting ? ' shortcut-row--capturing' : ''}`}>
                    <button
                      type="button"
                      className="shortcut-row__button"
                      aria-pressed={waiting}
                      onClick={() => {
                        setRefused(null);
                        setCapturing(waiting ? null : one.id);
                      }}
                    >
                      <span className="shortcut-row__label">{label}</span>
                      {waiting ? (
                        <span className="shortcut-row__capture">{words.capture}</span>
                      ) : (
                        <Keys choices={[keysOf(bindings[one.id], words.keys)]} words={words} />
                      )}
                    </button>
                    {refused?.action === one.id ? (
                      <p className="aparte-field-warning shortcut-row__refused" role="status">
                        {words.conflict(words.actions[refused.other])}
                      </p>
                    ) : null}
                  </li>
                );
              })}
              {fixedRows.map((one) => (
                <li key={one.label} className="shortcut-row shortcut-row--fixed">
                  <span className="shortcut-row__label">
                    {one.label}
                    <span className="shortcut-row__note">{words.fixedNote}</span>
                  </span>
                  <Keys choices={one.choices} words={words} />
                </li>
              ))}
            </ul>
          </Section>
        ),
      )}
    </div>
  );
}
