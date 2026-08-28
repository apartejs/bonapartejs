/**
 * Tooling panel tabs — pure state, testable without React.
 *
 * The panel used to be FIXED: one tab per plugin view, non-closable, and the
 * same set for the whole application. Two consequences Paul flagged: you
 * couldn't open two terminals, and a terminal opened in one conversation
 * would reappear in another — hence in the previous project's folder.
 *
 * Here, tabs are OPENED by the user (`+` button), closable, several per type
 * when the manifest allows it, and filed UNDER the conversation. The
 * manifest no longer declares tabs: it declares what CAN be opened.
 */

import {
  localize,
  type BonaparteLocale,
  type PluginStatusDto,
} from '@aparte/bonaparte-shared';

/** An openable view, as a plugin's manifest declares it. */
export interface ToolingViewDescriptor {
  pluginId: string;
  viewId: string;
  title: string;
  icon?: string;
  order: number;
  /** Several simultaneous instances allowed (two terminals, two pages). */
  multiple: boolean;
  /** Shortcut shown in the menu — informational, the window wires it up. */
  shortcut?: string;
}

/**
 * What the active plugins can open, in the order they suggest, with every
 * title resolved for the locale — a tab title is a UI string like any other.
 */
export function listViews(
  plugins: PluginStatusDto[],
  locale: BonaparteLocale,
): ToolingViewDescriptor[] {
  return plugins
    .filter((plugin) => plugin.active)
    .flatMap((plugin) =>
      plugin.views.map((view) => ({
        pluginId: plugin.id,
        viewId: view.id,
        title: localize(view.title, locale),
        ...(view.icon ? { icon: view.icon } : {}),
        order: view.order ?? 100,
        multiple: view.multiple,
        ...(view.shortcut ? { shortcut: view.shortcut } : {}),
      })),
    )
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** An open tab. `instanceId` is the session's identity on the Node side. */
export interface ToolingTab {
  instanceId: string;
  pluginId: string;
  viewId: string;
  title: string;
  icon?: string;
  /**
   * What the tab was opened WITH, by another view — the URL a browser should
   * show, the script whose page it should follow. Read by the view when it
   * mounts; absent for a tab opened from the menu.
   */
  init?: Record<string, unknown>;
}

export interface ToolingTabsState {
  tabs: ToolingTab[];
  activeId: string | null;
  /**
   * MONOTONIC counter of this conversation's instances. It is persisted: an
   * identifier must never be reassigned, otherwise a new tab would inherit
   * the session that the Node half hasn't released yet.
   */
  seq: number;
}

export const EMPTY_TABS: ToolingTabsState = { tabs: [], activeId: null, seq: 0 };

const STORAGE_PREFIX = 'bonaparte.tooling.';

/** The subset of `localStorage` we use — so it can be faked in tests. */
export interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sameView(tab: ToolingTab, view: ToolingViewDescriptor): boolean {
  return tab.pluginId === view.pluginId && tab.viewId === view.viewId;
}

/**
 * Opens a tab, or ACTIVATES the existing one when the view only allows one
 * instance. Duplicate conversation Settings would make no sense; two
 * terminals do.
 */
export function openTab(
  state: ToolingTabsState,
  view: ToolingViewDescriptor,
  init?: Record<string, unknown>,
): ToolingTabsState {
  if (!view.multiple) {
    const existing = state.tabs.find((tab) => sameView(tab, view));
    if (existing) return activateTab(state, existing.instanceId);
  }

  const seq = state.seq + 1;
  const tab: ToolingTab = {
    instanceId: `${view.pluginId}:${view.viewId}:${seq}`,
    pluginId: view.pluginId,
    viewId: view.viewId,
    title: view.title,
    ...(view.icon ? { icon: view.icon } : {}),
    ...(init ? { init } : {}),
  };
  return { tabs: [...state.tabs, tab], activeId: tab.instanceId, seq };
}

/**
 * Closes a tab. The active one moves to its RIGHT neighbor — that's what
 * browsers and editors do: you keep moving forward.
 */
export function closeTab(state: ToolingTabsState, instanceId: string): ToolingTabsState {
  const index = state.tabs.findIndex((tab) => tab.instanceId === instanceId);
  if (index < 0) return state;

  const tabs = state.tabs.filter((tab) => tab.instanceId !== instanceId);
  if (tabs.length === 0) return { ...EMPTY_TABS, seq: state.seq };
  if (state.activeId !== instanceId) return { ...state, tabs };

  const next = tabs[index] ?? tabs[index - 1];
  return { ...state, tabs, activeId: next?.instanceId ?? null };
}

export function activateTab(
  state: ToolingTabsState,
  instanceId: string,
): ToolingTabsState {
  if (state.activeId === instanceId) return state;
  if (!state.tabs.some((tab) => tab.instanceId === instanceId)) return state;
  return { ...state, activeId: instanceId };
}

/**
 * Discards tabs whose view no longer exists — plugin deactivated, removed,
 * or manifest turned invalid. Returns the state UNCHANGED when there's
 * nothing to prune: this function runs on every render, a new object would
 * re-trigger the write and loop the effects.
 */
export function pruneTabs(
  state: ToolingTabsState,
  views: ToolingViewDescriptor[],
): ToolingTabsState {
  const tabs = state.tabs.filter((tab) => views.some((view) => sameView(tab, view)));
  if (tabs.length === state.tabs.length) return state;
  if (tabs.length === 0) return { ...EMPTY_TABS, seq: state.seq };

  const active = tabs.some((tab) => tab.instanceId === state.activeId)
    ? state.activeId
    : (tabs[0]?.instanceId ?? null);
  return { ...state, tabs, activeId: active };
}

function isTab(value: unknown): value is ToolingTab {
  const tab = value as Partial<ToolingTab> | null;
  return (
    typeof tab === 'object' &&
    tab !== null &&
    typeof tab.instanceId === 'string' &&
    typeof tab.pluginId === 'string' &&
    typeof tab.viewId === 'string' &&
    typeof tab.title === 'string'
  );
}

/**
 * Rereads a conversation's tabs. Any anomaly — broken JSON, unexpected
 * shape, unavailable storage — returns an EMPTY panel: losing tabs is
 * harmless, refusing to start is not.
 */
export function readTabs(
  storage: TabStorage,
  conversationId: string | null,
): ToolingTabsState {
  if (!conversationId) return EMPTY_TABS;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_PREFIX + conversationId);
  } catch {
    return EMPTY_TABS;
  }
  if (!raw) return EMPTY_TABS;

  try {
    const parsed = JSON.parse(raw) as Partial<ToolingTabsState>;
    if (!Array.isArray(parsed.tabs) || !parsed.tabs.every(isTab)) return EMPTY_TABS;
    const active =
      typeof parsed.activeId === 'string' &&
      parsed.tabs.some((tab) => tab.instanceId === parsed.activeId)
        ? parsed.activeId
        : (parsed.tabs[0]?.instanceId ?? null);
    return {
      tabs: parsed.tabs,
      activeId: active,
      seq: typeof parsed.seq === 'number' ? parsed.seq : parsed.tabs.length,
    };
  } catch {
    return EMPTY_TABS;
  }
}

export function writeTabs(
  storage: TabStorage,
  conversationId: string | null,
  state: ToolingTabsState,
): void {
  if (!conversationId) return;
  try {
    if (state.tabs.length === 0 && state.seq === 0) {
      storage.removeItem(STORAGE_PREFIX + conversationId);
      return;
    }
    storage.setItem(STORAGE_PREFIX + conversationId, JSON.stringify(state));
  } catch {
    /* storage unavailable: the tabs won't survive, the app will */
  }
}
