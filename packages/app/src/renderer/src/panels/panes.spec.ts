/**
 * Which panes are open: each icon its own, in one order beside the
 * conversation, the last opened alone over it in a narrow window.
 */

import { describe, expect, it } from 'vitest';
import {
  browserOpens,
  close,
  forgetPanes,
  movePanes,
  opened,
  opensByItself,
  paneKey,
  panesOf,
  pluginOfPane,
  pluginPane,
  shownPanes,
  toggle,
  withPanes,
  type OpenPanes,
  type PanesByConversation,
} from './panes';

describe('the panes', () => {
  it('each icon opens and closes its own pane; they stack in one order', () => {
    const open = toggle(toggle([], 'terminal'), 'files');
    expect(shownPanes(open, false)).toEqual(['files', 'terminal']);
    expect(shownPanes(toggle(open, 'terminal'), false)).toEqual(['files']);
    expect(close(open, 'files')).toEqual(['terminal']);
    expect(opened(open, 'files')).toBe(open);
  });

  it('over the conversation, the last opened alone; an icon there takes the place of the pane shown', () => {
    expect(shownPanes(['files', 'terminal'], true)).toEqual(['terminal']);
    expect(shownPanes([], true)).toEqual([]);
    expect(toggle(['files'], 'terminal', true)).toEqual(['terminal']);
    expect(toggle(['terminal'], 'terminal', true)).toEqual([]);
  });

  it('Changements opens by itself unless the person said never', () => {
    expect(opensByItself('approval')).toBe(true);
    expect(opensByItself('always')).toBe(true);
    expect(opensByItself(undefined)).toBe(true);
    expect(opensByItself('never')).toBe(false);
  });
});

describe('the panes of a plugin (task 11.2)', () => {
  it('open after the app’s own, in the order they were opened, and are named after their plugin', () => {
    let open: OpenPanes = [];
    open = toggle(open, pluginPane('notes', 'list'));
    open = toggle(open, 'terminal');
    open = toggle(open, pluginPane('revue-pr', 'revue'));
    open = toggle(open, 'files');
    expect(shownPanes(open, false)).toEqual(['files', 'terminal', 'plugin:notes:list', 'plugin:revue-pr:revue']);
    expect(pluginOfPane('plugin:revue-pr:revue')).toEqual({ pluginId: 'revue-pr', paneId: 'revue' });
    expect(pluginOfPane('terminal')).toBeNull();
  });
});

describe('a page the agent opened (the browser redo, step 1)', () => {
  it('opens the pane of the conversation shown, as the person allows; else marks its icon', () => {
    const shown = { autoOpen: true, shown: true, narrow: false, waits: false };
    expect(browserOpens(shown)).toBe('open');
    // « Jamais »: never by itself.
    expect(browserOpens({ ...shown, autoOpen: false })).toBe('mark');
    // Another conversation's page: its pane opens when the person goes back to it.
    expect(browserOpens({ ...shown, shown: false })).toBe('mark');
    // Narrow, the pane would cover an approval or a question that waits.
    expect(browserOpens({ ...shown, narrow: true, waits: true })).toBe('mark');
    expect(browserOpens({ ...shown, narrow: true })).toBe('open');
  });

  it('each conversation has its own panes; a new one none, until its first message makes it a conversation (the browser redo, step 2)', () => {
    let all: PanesByConversation = new Map();
    const a = paneKey('a', 'chat-1');
    const fresh = paneKey(null, 'chat-2');
    expect(a).toBe('a');
    expect(fresh).not.toBe(paneKey(null, 'chat-3'));
    all = withPanes(all, a, (open) => opened(open, 'browser'));
    expect(panesOf(all, a)).toEqual(['browser']);
    // Another conversation, and a new one, have none — the same empty list each time, for React.
    expect(panesOf(all, 'b')).toEqual([]);
    expect(panesOf(all, fresh)).toBe(panesOf(all, 'b'));
    // Nothing changed: the same map, so nothing draws again.
    expect(withPanes(all, a, (open) => opened(open, 'browser'))).toBe(all);
    // A new conversation's panes follow it once its first message makes it one.
    all = withPanes(all, fresh, (open) => opened(open, 'terminal'));
    all = movePanes(all, fresh, 'c');
    expect(panesOf(all, 'c')).toEqual(['terminal']);
    expect(panesOf(all, fresh)).toEqual([]);
    expect(movePanes(all, 'none', 'd')).toBe(all);
    // A conversation deleted or archived: its panes go.
    all = forgetPanes(all, a);
    expect(panesOf(all, a)).toEqual([]);
    expect(forgetPanes(all, a)).toBe(all);
  });
});
