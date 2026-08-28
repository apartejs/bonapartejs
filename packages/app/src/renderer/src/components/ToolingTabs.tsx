import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';
import { PlusGlyph } from './icons.js';

interface ToolingTabsProps {
  tooling: ToolingTabsApi;
}

/** Where to place the menu, in window coordinates. */
interface MenuAnchor {
  top: number;
  right: number;
}

/**
 * Tooling panel's tab strip — in the HEADER, not in the panel.
 *
 * This is the Codex model, and it has a reason: the tab strip and the
 * conversation title then live on the SAME line, the top bar is a single
 * piece, and opening the panel doesn't make a second bar appear under the
 * first.
 *
 * The opening menu is FIXED position, anchored to its button. This isn't a
 * refinement: the area carrying the tab strip collapses by sliding, so it
 * must clip whatever overflows (`overflow: hidden`) — and a menu positioned
 * absolutely inside it was getting clipped along with it. The click was
 * opening a genuinely invisible menu.
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
    // The menu is anchored in window coordinates: on a resize or a
    // separator drag, it must either follow its button or disappear.
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
        className="icon-button"
        onClick={() => (anchor ? setAnchor(null) : place())}
        aria-expanded={anchor !== null}
        aria-label={t.tooling.open}
        title={t.tooling.open}
      >
        <PlusGlyph />
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
