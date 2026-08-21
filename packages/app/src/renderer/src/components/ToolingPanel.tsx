import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { loadPluginView, type ToolingViewComponent } from '../plugins/views.js';

interface ToolingPanelProps {
  plugins: PluginStatusDto[];
  projectRoot: string | null;
  conversationId: string | null;
  /**
   * Le repli est REMONTÉ au shell : il se persiste et se pilote au clavier
   * (Ctrl+Alt+B) avec le reste de la disposition. Un état local ici serait
   * oublié à chaque rechargement, et invisible du raccourci.
   */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface Tab {
  key: string;
  pluginId: string;
  title: string;
  icon?: string;
  order: number;
}

/**
 * Panneau d'outillage (à droite) — un conteneur MULTI-VUES, pas un navigateur.
 * Chaque plugin actif y monte ses onglets ; le panneau ne fournit que
 * l'onglet et la place, la vue est souveraine sur son contenu.
 */
export function ToolingPanel({
  plugins,
  projectRoot,
  conversationId,
  collapsed,
  onToggleCollapsed,
}: ToolingPanelProps) {
  const { t, locale } = useTranslate();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [View, setView] = useState<ToolingViewComponent | null>(null);
  const [failed, setFailed] = useState(false);

  const tabs: Tab[] = plugins
    .filter((plugin) => plugin.active)
    .flatMap((plugin) =>
      plugin.views.map((view) => ({
        key: `${plugin.id}:${view.id}`,
        pluginId: plugin.id,
        title: view.title,
        ...(view.icon ? { icon: view.icon } : {}),
        order: view.order ?? 100,
      })),
    )
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const current = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  useEffect(() => {
    if (!current) {
      setView(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void loadPluginView(current.pluginId)
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
  }, [current?.pluginId, current?.key]);

  if (tabs.length === 0) return null;

  if (collapsed) {
    return (
      <aside className="tooling-panel tooling-collapsed">
        <button
          type="button"
          className="tooling-handle"
          onClick={onToggleCollapsed}
          title={t.tooling.expand}
        >
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="tooling-panel" aria-label={t.tooling.heading}>
      <div className="tooling-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === current?.key}
            className={`tooling-tab${tab.key === current?.key ? ' tooling-tab-active' : ''}`}
            onClick={() => setActiveKey(tab.key)}
          >
            {tab.icon && <span className="tooling-tab-icon">{tab.icon}</span>}
            {tab.title}
          </button>
        ))}
        <button
          type="button"
          className="tooling-handle"
          onClick={onToggleCollapsed}
          title={t.tooling.collapse}
        >
          ›
        </button>
      </div>

      <div className="tooling-body" role="tabpanel">
        {failed ? (
          <p className="tooling-error">{t.tooling.loadFailed}</p>
        ) : View ? (
          <View projectRoot={projectRoot} conversationId={conversationId} locale={locale} />
        ) : null}
      </div>
    </aside>
  );
}
