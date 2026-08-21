import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';

interface ToolingTabsProps {
  tooling: ToolingTabsApi;
}

/**
 * Bande d'onglets du panneau d'outillage — dans l'EN-TÊTE, pas dans le panneau.
 *
 * C'est le modèle de Codex, et il a une raison : la bande d'onglets et le titre
 * de la conversation vivent alors sur la MÊME ligne, la barre du haut est une
 * seule pièce, et l'ouverture du panneau ne fait pas apparaître une deuxième
 * barre sous la première.
 */
export function ToolingTabs({ tooling }: ToolingTabsProps) {
  const { t } = useTranslate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <div className="tooling-tabs">
      <div className="tooling-tablist" role="tablist" aria-label={t.tooling.heading}>
        {tooling.tabs.map((tab) => (
          <span
            key={tab.instanceId}
            className={`tooling-tab${
              tab.instanceId === tooling.active?.instanceId ? ' tooling-tab-active' : ''
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.instanceId === tooling.active?.instanceId}
              className="tooling-tab-label"
              onClick={() => tooling.activate(tab.instanceId)}
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
              onClick={() => tooling.close(tab.instanceId)}
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
          <div className="tooling-menu popover" role="menu" aria-label={t.tooling.openMenu}>
            {tooling.views.length === 0 ? (
              <p className="tooling-menu-empty">{t.tooling.nothingToOpen}</p>
            ) : (
              tooling.views.map((view) => (
                <button
                  key={`${view.pluginId}:${view.viewId}`}
                  type="button"
                  role="menuitem"
                  className="tooling-menu-item"
                  onClick={() => {
                    tooling.open(view);
                    setMenuOpen(false);
                  }}
                >
                  <span className="tooling-menu-icon" aria-hidden="true">
                    {view.icon ?? '▫'}
                  </span>
                  <span className="tooling-menu-title">{view.title}</span>
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
  );
}
