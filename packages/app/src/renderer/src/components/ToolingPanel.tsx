import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { loadPluginView, type ToolingViewComponent } from '../plugins/views.js';
import {
  EMPTY_TABS,
  activateTab,
  closeTab,
  openTab,
  pruneTabs,
  readTabs,
  writeTabs,
  type ToolingTabsState,
  type ToolingViewDescriptor,
} from '../tooling/tabs.js';

interface ToolingPanelProps {
  plugins: PluginStatusDto[];
  projectRoot: string | null;
  conversationId: string | null;
}

/**
 * Panneau d'outillage — un conteneur d'onglets OUVERTS PAR L'UTILISATEUR.
 *
 * Il était figé : un onglet par vue déclarée, non fermable, et le même jeu
 * pour toute l'application. On ne pouvait donc pas ouvrir deux terminaux, et
 * un terminal ouvert ici réapparaissait dans la conversation suivante — dans
 * le dossier du projet précédent, ce qui est franchement pire que rien.
 *
 * Désormais : `+` propose ce que les plugins actifs savent ouvrir, chaque
 * onglet se ferme, plusieurs instances du même type coexistent, et l'ensemble
 * appartient à la CONVERSATION.
 *
 * Seul l'onglet actif est monté. C'est volontaire : une vue de plugin peut
 * porter une surface native (la `WebContentsView` du navigateur) qui n'est pas
 * un élément du DOM et se poserait par-dessus le panneau depuis un onglet
 * caché. Les sessions, elles, vivent côté Node et se rattachent au remontage.
 */
export function ToolingPanel({ plugins, projectRoot, conversationId }: ToolingPanelProps) {
  const { t, locale } = useTranslate();
  const [state, setState] = useState<ToolingTabsState>(EMPTY_TABS);
  const [View, setView] = useState<ToolingViewComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Ce que les plugins ACTIFS savent ouvrir, dans l'ordre qu'ils suggèrent. */
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
      setMenuOpen(false);
    },
    [update],
  );

  /**
   * Les accélérateurs déclarés par les plugins sont réellement câblés — un
   * raccourci affiché dans un menu et inopérant est pire que pas de raccourci.
   * Ils n'agissent que panneau ouvert : c'est le seul moment où ajouter un
   * onglet a un sens visible.
   */
  useEffect(() => {
    const shortcuts = views.filter((view) => view.shortcut);
    if (shortcuts.length === 0) return;

    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const match = shortcuts.find((view) => {
        const key = view.shortcut?.split('+').pop()?.toLowerCase();
        return key === event.key.toLowerCase();
      });
      if (!match) return;
      event.preventDefault();
      open(match);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [views, open]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const active = state.tabs.find((tab) => tab.instanceId === state.activeId) ?? null;

  useEffect(() => {
    if (!active) {
      setView(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void loadPluginView(active.pluginId)
      .then((component) => {
        if (cancelled) return;
        setView(() => component);
        setFailed(component === null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.pluginId, active?.instanceId]);

  return (
    <aside className="tooling-panel" aria-label={t.tooling.heading}>
      <div className="tooling-tabs">
        <div className="tooling-tablist" role="tablist" aria-label={t.tooling.heading}>
          {state.tabs.map((tab) => (
            <span
              key={tab.instanceId}
              className={`tooling-tab${tab.instanceId === state.activeId ? ' tooling-tab-active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.instanceId === state.activeId}
                className="tooling-tab-label"
                onClick={() => update((current) => activateTab(current, tab.instanceId))}
                title={tab.title}
              >
                {tab.icon && (
                  <span className="tooling-tab-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                {tab.title}
              </button>
              <button
                type="button"
                className="tooling-tab-close"
                onClick={() => update((current) => closeTab(current, tab.instanceId))}
                aria-label={`${t.tooling.close} — ${tab.title}`}
                title={t.tooling.close}
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>

        <div className="tooling-add" ref={menuRef}>
          <button
            type="button"
            className="tooling-add-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-label={t.tooling.open}
            title={t.tooling.open}
          >
            <span aria-hidden="true">+</span>
          </button>

          {menuOpen && (
            <div className="tooling-menu" role="menu" aria-label={t.tooling.openMenu}>
              {views.length === 0 ? (
                <p className="tooling-menu-empty">{t.tooling.nothingToOpen}</p>
              ) : (
                views.map((view) => (
                  <button
                    key={`${view.pluginId}:${view.viewId}`}
                    type="button"
                    role="menuitem"
                    className="tooling-menu-item"
                    onClick={() => open(view)}
                  >
                    <span className="tooling-menu-icon" aria-hidden="true">
                      {view.icon ?? '▫'}
                    </span>
                    <span className="tooling-menu-title">{view.title}</span>
                    {/* L'accélérateur est déclaré par le plugin : il l'affiche
                        parce qu'il l'enseigne, pas parce qu'il le câble. */}
                    {view.shortcut && (
                      <kbd className="tooling-menu-shortcut">{view.shortcut}</kbd>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="tooling-body" role="tabpanel">
        {!active ? (
          <p className="tooling-empty">{t.tooling.emptyHint}</p>
        ) : failed ? (
          <p className="tooling-error">{t.tooling.loadFailed}</p>
        ) : View ? (
          // La clé porte l'instance : deux terminaux sont deux montages, et
          // fermer puis rouvrir repart d'une vue neuve.
          <View
            key={active.instanceId}
            instanceId={active.instanceId}
            projectRoot={projectRoot}
            conversationId={conversationId}
            locale={locale}
          />
        ) : null}
      </div>
    </aside>
  );
}
