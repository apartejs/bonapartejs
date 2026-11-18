/**
 * Which panes are open: each icon its own, in one order beside the
 * conversation, the last opened alone over it in a narrow window.
 */

import { describe, expect, it } from 'vitest';
import { close, opened, opensByItself, pluginOfPane, pluginPane, shownPanes, toggle, type OpenPanes } from './panes';

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
