import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import {
  EMPTY_TABS,
  activateTab,
  closeTab,
  listViews,
  openTab,
  pruneTabs,
  readTabs,
  writeTabs,
  type ToolingTab,
  type ToolingTabsState,
  type ToolingViewDescriptor,
} from './tabs.js';

export interface ToolingTabsApi {
  /** What the active plugins know how to open, in the order they suggest. */
  views: ToolingViewDescriptor[];
  tabs: ToolingTab[];
  active: ToolingTab | null;
  open: (view: ToolingViewDescriptor, init?: Record<string, unknown>) => void;
  /** Opens a view by identity — what a view asks for another. False when no active plugin offers it. */
  openView: (pluginId: string, viewId: string, init?: Record<string, unknown>) => boolean;
  close: (instanceId: string) => void;
  activate: (instanceId: string) => void;
}

interface Options {
  conversationId: string | null;
  plugins: PluginStatusDto[];
  /**
   * Called when a view opens. The panel may be collapsed — a shortcut that
   * opened an invisible tab would be useless.
   */
  onOpen?: () => void;
}

/**
 * The tooling panel's tabs, filed UNDER the conversation.
 *
 * The state lives here rather than in the panel, because the tab strip is in
 * the HEADER (Codex-style) and the content in the panel: two components, one
 * single state, held by the shell.
 */
export function useToolingTabs({ conversationId, plugins, onOpen }: Options): ToolingTabsApi {
  const [state, setState] = useState<ToolingTabsState>(EMPTY_TABS);
  const { locale } = useTranslate();

  const views = useMemo<ToolingViewDescriptor[]>(
    () => listViews(plugins, locale),
    [plugins, locale],
  );

  // Changing conversation changes the tab set: we reread its own.
  useEffect(() => {
    setState(readTabs(window.localStorage, conversationId));
  }, [conversationId]);

  // A deactivated plugin leaves orphaned tabs: we discard them.
  useEffect(() => {
    setState((current) => pruneTabs(current, views));
  }, [views]);

  const update = useCallback(
    (next: (current: ToolingTabsState) => ToolingTabsState) => {
      setState((current) => {
        const after = next(current);
        if (after !== current) writeTabs(window.localStorage, conversationId, after);
        return after;
      });
    },
    [conversationId],
  );

  const open = useCallback(
    (view: ToolingViewDescriptor, init?: Record<string, unknown>) => {
      update((current) => openTab(current, view, init));
      onOpen?.();
    },
    [update, onOpen],
  );

  const openView = useCallback(
    (pluginId: string, viewId: string, init?: Record<string, unknown>): boolean => {
      const view = views.find((v) => v.pluginId === pluginId && v.viewId === viewId);
      if (!view) return false;
      open(view, init);
      return true;
    },
    [views, open],
  );

  const close = useCallback(
    (instanceId: string) => update((current) => closeTab(current, instanceId)),
    [update],
  );

  const activate = useCallback(
    (instanceId: string) => update((current) => activateTab(current, instanceId)),
    [update],
  );

  /**
   * Shortcuts declared by plugins are actually wired up — a shortcut shown
   * in a menu that doesn't work is worse than no shortcut at all. They live
   * here, not in the panel: a collapsed panel isn't mounted, and `Ctrl+&#96;`
   * must open a terminal even in that case (which is what any editor does).
   */
  useEffect(() => {
    const shortcuts = views.filter((view) => view.shortcut);
    if (shortcuts.length === 0) return;

    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const pressed = event.key.toLowerCase();
      const match = shortcuts.find(
        (view) => view.shortcut?.split('+').pop()?.toLowerCase() === pressed,
      );
      if (!match) return;
      event.preventDefault();
      open(match);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [views, open]);

  return {
    views,
    tabs: state.tabs,
    active: state.tabs.find((tab) => tab.instanceId === state.activeId) ?? null,
    open,
    openView,
    close,
    activate,
  };
}
