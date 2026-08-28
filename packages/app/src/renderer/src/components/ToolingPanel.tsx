import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { loadPluginView, type ToolingViewComponent } from '../plugins/views.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';
import { FlankToggle } from './FlankToggle.js';
import { ToolingHome } from './ToolingHome.js';
import { ToolingTabs } from './ToolingTabs.js';

interface ToolingPanelProps {
  tooling: ToolingTabsApi;
  projectRoot: string | null;
  conversationId: string | null;
  onClose: () => void;
}

/**
 * Tooling panel: its tab bar, then the active view.
 *
 * Its bar has exactly the height of the conversation's, and its bottom
 * border falls on the same pixel: the two read as a single line running
 * across the window, even though each belongs to its own column. This is
 * what lets the conversations flank rise all the way to the top.
 *
 * Only the active tab is mounted. This is deliberate: a plugin view can
 * carry a native surface (the browser's `WebContentsView`) which is not a
 * DOM element and would sit on top of the panel from a hidden tab. Sessions,
 * on the other hand, live on the Node side and reattach on remount.
 */
export function ToolingPanel({
  tooling,
  projectRoot,
  conversationId,
  onClose,
}: ToolingPanelProps) {
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
    <aside className="tooling-panel flex min-h-0 flex-col border-s bg-card" aria-label={t.tooling.heading}>
      <div className="tooling-bar flex h-(--bp-bar) shrink-0 items-stretch border-b pe-2">
        <ToolingTabs tooling={tooling} />
        <FlankToggle
          side="end"
          collapsed={false}
          label={t.layout.collapsePanel}
          shortcut="Ctrl+Alt+B"
          onToggle={onClose}
        />
      </div>

      <div className="tooling-body min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
        {!active ? (
          <ToolingHome tooling={tooling} projectRoot={projectRoot} />
        ) : failed ? (
          <p className="tooling-error text-[12.5px] text-destructive">{t.tooling.loadFailed}</p>
        ) : View ? (
          // The key carries the instance: two terminals are two mounts, and
          // closing then reopening starts fresh with a new view.
          <View
            key={active.instanceId}
            instanceId={active.instanceId}
            projectRoot={projectRoot}
            conversationId={conversationId}
            locale={locale}
            {...(active.init ? { init: active.init } : {})}
            openView={tooling.openView}
          />
        ) : null}
      </div>
    </aside>
  );
}
