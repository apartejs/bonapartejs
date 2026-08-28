import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TABS,
  activateTab,
  closeTab,
  listViews,
  openTab,
  pruneTabs,
  readTabs,
  writeTabs,
  type ToolingTabsState,
  type ToolingViewDescriptor,
} from './tabs.js';

describe('listViews', () => {
  const browser: PluginStatusDto = {
    id: 'browser',
    name: { en: 'Tooled browser', fr: 'Navigateur outillé' },
    version: '0.1.0',
    enabled: true,
    active: true,
    views: [{ id: 'page', title: { en: 'Browser', fr: 'Navigateur' }, multiple: true, order: 40 }],
    toolNames: [],
    configSchemas: [],
  };

  it('localises the titles of the views the active plugins declare', () => {
    // A tab title is a UI string: it follows the locale like every other
    // label, instead of showing whatever language the manifest was written in.
    expect(listViews([browser], 'fr').map((view) => view.title)).toEqual(['Navigateur']);
    expect(listViews([browser], 'en').map((view) => view.title)).toEqual(['Browser']);
  });

  it('ignores inactive plugins', () => {
    expect(listViews([{ ...browser, active: false }], 'en')).toEqual([]);
  });
});

const terminal: ToolingViewDescriptor = {
  pluginId: 'terminal',
  viewId: 'shell',
  title: 'Terminal',
  multiple: true,
  order: 30,
};

const settings: ToolingViewDescriptor = {
  pluginId: 'conversation-settings',
  viewId: 'settings',
  title: 'Conversation',
  multiple: false,
  order: 10,
};

/** Test localStorage — the real one can throw (private mode, quota). */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: data,
  };
}

describe('tooling panel tabs', () => {
  it('opens a tab and activates it', () => {
    const state = openTab(EMPTY_TABS, terminal);

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.pluginId).toBe('terminal');
    expect(state.activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('opens SEVERAL instances of the same type, with distinct identities', () => {
    // This is the request: "you can open as many as you want." Two
    // terminals are two shells, hence two instances, hence two ids.
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]?.instanceId).not.toBe(state.tabs[1]?.instanceId);
    expect(state.activeId).toBe(state.tabs[1]?.instanceId);
  });

  it('NEVER reuses an identifier, even after closing', () => {
    // A reused id would land back on the session that the Node half may not
    // have released yet: the new tab would inherit the old stream.
    const first = openTab(EMPTY_TABS, terminal);
    const gone = closeTab(first, first.tabs[0]?.instanceId as string);
    const second = openTab(gone, terminal);

    expect(second.tabs[0]?.instanceId).not.toBe(first.tabs[0]?.instanceId);
  });

  it('a single-instance type just gets activated if it’s already there', () => {
    const opened = openTab(openTab(EMPTY_TABS, settings), terminal);
    const again = openTab(opened, settings);

    expect(again.tabs).toHaveLength(2);
    expect(again.activeId).toBe(opened.tabs[0]?.instanceId);
  });

  it('closing the active tab activates its right-hand neighbor', () => {
    const state = openTab(openTab(openTab(EMPTY_TABS, terminal), terminal), terminal);
    const middle = state.tabs[1]?.instanceId as string;
    const closed = closeTab(activateTab(state, middle), middle);

    expect(closed.tabs).toHaveLength(2);
    expect(closed.activeId).toBe(state.tabs[2]?.instanceId);
  });

  it('closing the last tab falls back to the one on the left', () => {
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);
    const last = state.tabs[1]?.instanceId as string;

    expect(closeTab(state, last).activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('closing an inactive tab does not change the active tab', () => {
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);
    const closed = closeTab(state, state.tabs[0]?.instanceId as string);

    expect(closed.activeId).toBe(state.activeId);
  });

  it('closing the last tab leaves the panel empty — but keeps the counter', () => {
    // Emptying the panel does NOT reset the counter to zero: otherwise the
    // next tab would reuse the identifier of the one we just closed.
    const state = openTab(EMPTY_TABS, terminal);
    const closed = closeTab(state, state.tabs[0]?.instanceId as string);

    expect(closed.tabs).toEqual([]);
    expect(closed.activeId).toBeNull();
    expect(closed.seq).toBe(state.seq);
  });

  it('discards tabs whose view has disappeared (plugin deactivated)', () => {
    // A plugin being deactivated leaves orphaned tabs in memory: without
    // pruning, the panel would show a tab that's impossible to load.
    const state = openTab(openTab(EMPTY_TABS, terminal), settings);
    const pruned = pruneTabs(state, [settings]);

    expect(pruned.tabs.map((tab) => tab.pluginId)).toEqual(['conversation-settings']);
    expect(pruned.activeId).toBe(state.tabs[1]?.instanceId);
  });

  it('pruning reactivates a survivor when the active one has disappeared', () => {
    const state = openTab(openTab(EMPTY_TABS, settings), terminal);
    const pruned = pruneTabs(state, [settings]);

    expect(pruned.activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('pruning does not recreate an object when nothing changes', () => {
    // Pruning runs on every render: returning a new object would re-trigger
    // the write and loop the effects.
    const state = openTab(EMPTY_TABS, terminal);

    expect(pruneTabs(state, [terminal, settings])).toBe(state);
  });
});

describe('per-conversation persistence', () => {
  it('files tabs UNDER the conversation, not globally', () => {
    // What Paul asked for: "this view on the right is tied to a
    // conversation." Two conversations, two sets of tabs.
    const storage = fakeStorage();
    const one = openTab(EMPTY_TABS, terminal);
    writeTabs(storage, 'conv-a', one);

    expect(readTabs(storage, 'conv-a')).toEqual(one);
    expect(readTabs(storage, 'conv-b')).toEqual(EMPTY_TABS);
  });

  it('persists nothing when no conversation is open', () => {
    const storage = fakeStorage();
    writeTabs(storage, null, openTab(EMPTY_TABS, terminal));

    expect(storage.raw.size).toBe(0);
    expect(readTabs(storage, null)).toEqual(EMPTY_TABS);
  });

  it('unreadable content yields an empty panel instead of throwing', () => {
    const storage = fakeStorage({ 'bonaparte.tooling.conv-a': '{oops' });

    expect(readTabs(storage, 'conv-a')).toEqual(EMPTY_TABS);
  });

  it('content of the right shape but wrong type is discarded', () => {
    const storage = fakeStorage({
      'bonaparte.tooling.conv-a': '{"tabs":[{"pluginId":42}],"activeId":null,"seq":0}',
    });

    expect(readTabs(storage, 'conv-a')).toEqual(EMPTY_TABS);
  });

  it('survives a storage that throws (private mode, quota)', () => {
    const hostile = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
    };

    expect(readTabs(hostile, 'conv-a')).toEqual(EMPTY_TABS);
    expect(() => writeTabs(hostile, 'conv-a', EMPTY_TABS as ToolingTabsState)).not.toThrow();
  });
});

describe('a view opened by another view', () => {
  const browser: ToolingViewDescriptor = {
    pluginId: 'browser',
    viewId: 'page',
    title: 'Browser',
    order: 40,
    multiple: true,
  };

  it('a tab carries the payload it was opened with', () => {
    // "Open this URL in a browser tab", asked by the launcher: the payload
    // travels with the tab, and the view reads it when it mounts.
    const state = openTab(EMPTY_TABS, browser, { url: 'http://localhost:5174/' });

    expect(state.tabs[0]?.init).toEqual({ url: 'http://localhost:5174/' });
  });

  it('a tab opened without payload carries none', () => {
    const state = openTab(EMPTY_TABS, browser);

    expect(state.tabs[0]?.init).toBeUndefined();
  });
});
