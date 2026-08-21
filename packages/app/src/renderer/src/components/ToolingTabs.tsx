import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';

interface ToolingTabsProps {
  tooling: ToolingTabsApi;
}

/** Où poser le menu, en coordonnées de fenêtre. */
interface MenuAnchor {
  top: number;
  right: number;
}

/**
 * Bande d'onglets du panneau d'outillage — dans l'EN-TÊTE, pas dans le panneau.
 *
 * C'est le modèle de Codex, et il a une raison : la bande d'onglets et le titre
 * de la conversation vivent alors sur la MÊME ligne, la barre du haut est une
 * seule pièce, et l'ouverture du panneau ne fait pas apparaître une deuxième
 * barre sous la première.
 *
 * Le menu d'ouverture est en position FIXE, ancré sur son bouton. Ce n'est pas
 * un raffinement : la zone qui porte la bande d'onglets se replie en glissant,
 * donc elle doit couper ce qui dépasse (`overflow: hidden`) — et un menu en
 * position absolue à l'intérieur se faisait couper avec. Le clic ouvrait un
 * menu réellement invisible.
 */
export function ToolingTabs({ tooling }: ToolingTabsProps) {
  const { t } = useTranslate();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setAnchor({
      top: Math.round(rect.bottom + 6),
      right: Math.round(window.innerWidth - rect.right),
    });
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const close = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setAnchor(null);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAnchor(null);
    };
    // Le menu est ancré en coordonnées de fenêtre : s'il y a redimensionnement
    // ou glissement de séparateur, il doit suivre son bouton ou disparaître.
    const drop = (): void => setAnchor(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', drop);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', drop);
    };
  }, [anchor]);

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

      <button
        ref={buttonRef}
        type="button"
        className="tooling-add-button"
        onClick={() => (anchor ? setAnchor(null) : place())}
        aria-expanded={anchor !== null}
        aria-label={t.tooling.open}
        title={t.tooling.open}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M8 3.75v8.5M3.75 8h8.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {anchor && (
        <div
          ref={menuRef}
          className="tooling-menu popover"
          role="menu"
          aria-label={t.tooling.openMenu}
          style={{ top: anchor.top, right: anchor.right }}
        >
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
                  setAnchor(null);
                }}
              >
                <span className="tooling-menu-icon" aria-hidden="true">
                  {view.icon ?? '▫'}
                </span>
                <span className="tooling-menu-title">{view.title}</span>
                {view.shortcut && <kbd className="tooling-menu-shortcut">{view.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
