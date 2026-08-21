import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { loadPluginView, type ToolingViewComponent } from '../plugins/views.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';

interface ToolingPanelProps {
  tooling: ToolingTabsApi;
  projectRoot: string | null;
  conversationId: string | null;
}

/**
 * Panneau d'outillage — le CORPS des onglets, rien d'autre.
 *
 * La bande d'onglets est remontée dans l'en-tête (cf. `ToolingTabs`) : ce
 * composant ne fait plus que charger la vue active et lui laisser la place.
 *
 * Seul l'onglet actif est monté. C'est volontaire : une vue de plugin peut
 * porter une surface native (la `WebContentsView` du navigateur) qui n'est pas
 * un élément du DOM et se poserait par-dessus le panneau depuis un onglet
 * caché. Les sessions, elles, vivent côté Node et se rattachent au remontage.
 */
export function ToolingPanel({ tooling, projectRoot, conversationId }: ToolingPanelProps) {
  const { t, locale } = useTranslate();
  const [View, setView] = useState<ToolingViewComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const active = tooling.active;

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
