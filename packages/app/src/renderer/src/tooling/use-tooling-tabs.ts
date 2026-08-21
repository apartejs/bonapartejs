import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_TABS,
  activateTab,
  closeTab,
  openTab,
  pruneTabs,
  readTabs,
  writeTabs,
  type ToolingTab,
  type ToolingTabsState,
  type ToolingViewDescriptor,
} from './tabs.js';

export interface ToolingTabsApi {
  /** Ce que les plugins actifs savent ouvrir, dans l'ordre qu'ils suggèrent. */
  views: ToolingViewDescriptor[];
  tabs: ToolingTab[];
  active: ToolingTab | null;
  open: (view: ToolingViewDescriptor) => void;
  close: (instanceId: string) => void;
  activate: (instanceId: string) => void;
}

interface Options {
  conversationId: string | null;
  plugins: PluginStatusDto[];
  /**
   * Appelé quand une vue s'ouvre. Le panneau peut être replié — un raccourci
   * qui ouvrirait un onglet invisible ne servirait à rien.
   */
  onOpen?: () => void;
}

/**
 * Les onglets du panneau d'outillage, rangés SOUS la conversation.
 *
 * L'état vit ici plutôt que dans le panneau, parce que la bande d'onglets est
 * dans l'EN-TÊTE (modèle Codex) et le contenu dans le panneau : deux
 * composants, un seul état, tenu par la coquille.
 */
export function useToolingTabs({ conversationId, plugins, onOpen }: Options): ToolingTabsApi {
  const [state, setState] = useState<ToolingTabsState>(EMPTY_TABS);

  const views = useMemo<ToolingViewDescriptor[]>(
    () =>
      plugins
        .filter((plugin) => plugin.active)
        .flatMap((plugin) =>
          plugin.views.map((view) => ({
            pluginId: plugin.id,
            viewId: view.id,
            title: view.title,
            ...(view.icon ? { icon: view.icon } : {}),
            order: view.order ?? 100,
            multiple: view.multiple,
            ...(view.shortcut ? { shortcut: view.shortcut } : {}),
          })),
        )
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    [plugins],
  );

  // Changer de conversation change de jeu d'onglets : on relit le sien.
  useEffect(() => {
    setState(readTabs(window.localStorage, conversationId));
  }, [conversationId]);

  // Un plugin désactivé laisse des onglets orphelins : on les écarte.
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
    (view: ToolingViewDescriptor) => {
      update((current) => openTab(current, view));
      onOpen?.();
    },
    [update, onOpen],
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
   * Les accélérateurs déclarés par les plugins sont réellement câblés — un
   * raccourci affiché dans un menu et inopérant est pire que pas de raccourci.
   * Ils vivent ici, et non dans le panneau : le panneau replié n'est pas monté,
   * et `Ctrl+&#96;` doit ouvrir un terminal même dans ce cas (c'est ce que fait
   * n'importe quel éditeur).
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
    close,
    activate,
  };
}
