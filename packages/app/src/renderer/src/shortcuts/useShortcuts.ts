/**
 * The keys of the app, heard once (task 12.1): a key typed is read as one combination, the action it is bound to
 * is told on the window (`bonaparte-shortcut`), and whoever runs that action takes it — the key does nothing else
 * then. What the person changed (the setting `shortcuts`) is read at start and followed as it changes. While the
 * Raccourcis page captures a key, nothing runs.
 */

import { settingsGet } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import { SETTING_CHANGED } from '../settings/SettingsView';
import { actionFor, bindingsOf, comboOf, type Bindings, type ShortcutAction } from './registry';

export const SHORTCUT_EVENT = 'bonaparte-shortcut';
/** Set on `<body>` while the Raccourcis page waits for a key. */
export const CAPTURING = 'capturingShortcut';

const keptOf = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};

/** The bindings as the person left them, followed as they change. */
export function useBindings(): Bindings {
  const [bindings, setBindings] = useState<Bindings>(() => bindingsOf({}));
  useEffect(() => {
    let live = true;
    void bridge
      .invoke(settingsGet, { key: 'shortcuts' })
      .then((value) => {
        if (live) setBindings(bindingsOf(keptOf(value)));
      })
      .catch(() => undefined);
    const follow = (event: Event): void => {
      const { key, value } = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (key === 'shortcuts') setBindings(bindingsOf(keptOf(value)));
    };
    window.addEventListener(SETTING_CHANGED, follow);
    return () => {
      live = false;
      window.removeEventListener(SETTING_CHANGED, follow);
    };
  }, []);
  return bindings;
}

/** Mounted once: hears every key of the window and tells the action it is bound to. */
export function useShortcutKeys(): void {
  const bindings = useBindings();
  const current = useRef(bindings);
  current.current = bindings;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.body.dataset[CAPTURING] !== undefined) return;
      const combo = comboOf(event);
      const action = combo ? actionFor(current.current, combo) : null;
      if (!action) return;
      const told = new CustomEvent<{ action: ShortcutAction }>(SHORTCUT_EVENT, { detail: { action }, cancelable: true });
      // Taken by whoever runs it: the key then does nothing else.
      if (!window.dispatchEvent(told)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Runs `run` when the person types the keys of `action`. `run` says `false` when it does not take it now (a pane
 * not shown): the key then goes on as it would have.
 */
export function useShortcut(action: ShortcutAction, run: () => boolean | void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const heard = (event: Event): void => {
      if ((event as CustomEvent<{ action: ShortcutAction }>).detail.action !== action) return;
      if (latest.current() !== false) event.preventDefault();
    };
    window.addEventListener(SHORTCUT_EVENT, heard);
    return () => window.removeEventListener(SHORTCUT_EVENT, heard);
  }, [action]);
}
