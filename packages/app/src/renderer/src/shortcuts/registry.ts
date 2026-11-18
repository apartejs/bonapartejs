/**
 * The shortcuts of the app (task 12.1, board « Réglages · Raccourcis »): each action, its default keys, its group.
 * What the person changed is the setting `shortcuts` (an action → its keys, '' for none), kept by the core; the
 * window listens once, reads each key typed as one combination, and runs the action it is bound to. aparté has no
 * registry of its own (apartejs/aparte#263).
 */

export type ShortcutAction =
  | 'newConversation'
  | 'search'
  | 'inbox'
  | 'sidebar'
  | 'previousConversation'
  | 'nextConversation'
  | 'cycleMode'
  | 'rewindLast'
  | 'changes'
  | 'terminal'
  | 'browser'
  | 'newTab';

export type ShortcutGroup = 'conversations' | 'agent' | 'panes';

export interface Shortcut {
  id: ShortcutAction;
  group: ShortcutGroup;
  /** Its default keys, as `comboOf` writes them. */
  keys: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'newConversation', group: 'conversations', keys: 'Ctrl+N' },
  { id: 'search', group: 'conversations', keys: 'Ctrl+K' },
  { id: 'inbox', group: 'conversations', keys: 'Ctrl+J' },
  { id: 'sidebar', group: 'conversations', keys: 'Ctrl+B' },
  { id: 'previousConversation', group: 'conversations', keys: 'Ctrl+ArrowUp' },
  { id: 'nextConversation', group: 'conversations', keys: 'Ctrl+ArrowDown' },
  { id: 'cycleMode', group: 'agent', keys: 'Ctrl+Shift+M' },
  { id: 'rewindLast', group: 'agent', keys: 'Ctrl+Alt+Z' },
  { id: 'changes', group: 'panes', keys: 'Ctrl+Shift+D' },
  { id: 'terminal', group: 'panes', keys: 'Ctrl+`' },
  { id: 'browser', group: 'panes', keys: 'Ctrl+Shift+B' },
  { id: 'newTab', group: 'panes', keys: 'Ctrl+T' },
];

export type Bindings = Record<ShortcutAction, string>;

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * A key typed, as one combination: « Ctrl », « Alt », « Shift » in that order, then the key — a letter in capitals
 * (Shift changes its case, not the shortcut). A Mac's ⌘ counts as Ctrl. A modifier alone is no combination.
 */
export function comboOf(event: KeyLike): string | null {
  if (MODIFIERS.has(event.key) || event.key === 'Dead' || event.key === 'Unidentified') return null;
  const key = event.key === '+' ? 'Plus' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Whether a combination can be a shortcut: with Ctrl or Alt. A key alone, or with Shift, is what the person types
 * in a field — it would fire there, and swallow the letter (review 12).
 */
export function usable(combo: string): boolean {
  return /(?:^|\+)(?:Ctrl|Alt)\+/.test(combo);
}

const known = new Set<string>(SHORTCUTS.map((one) => one.id));

/** Each action's keys: the person's when they changed it, else its default. */
export function bindingsOf(changed: Readonly<Record<string, string>>): Bindings {
  const bindings = Object.fromEntries(SHORTCUTS.map((one) => [one.id, one.keys])) as Bindings;
  for (const [action, keys] of Object.entries(changed)) {
    if (known.has(action) && typeof keys === 'string') bindings[action as ShortcutAction] = keys;
  }
  return bindings;
}

/** The action these keys run, if any. */
export function actionFor(bindings: Bindings, combo: string): ShortcutAction | null {
  if (!combo) return null;
  const found = (Object.entries(bindings) as [ShortcutAction, string][]).find(([, keys]) => keys === combo);
  return found ? found[0] : null;
}

/** Another action that already holds these keys: given to `action`, they would be refused. */
export function conflictOf(bindings: Bindings, action: ShortcutAction, combo: string): ShortcutAction | null {
  const holder = actionFor(bindings, combo);
  return holder && holder !== action ? holder : null;
}

/** A combination as the keys a person reads, each in their words (« Maj », « ↑ »). */
export function keysOf(combo: string, words: Readonly<Record<string, string>>): string[] {
  if (!combo) return [];
  return combo.split('+').map((part) => words[part] ?? part);
}
