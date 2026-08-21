import { useCallback, useEffect, useState } from 'react';

/**
 * Disposition du shell : largeurs et replis des deux flancs.
 *
 * C'est une préférence d'AFFICHAGE, donc locale — la faire passer par l'IPC
 * ferait redémarrer le main process pour un panneau qu'on tire à la souris,
 * et redémarrer recharge le modèle en VRAM. Le compromis serait absurde.
 *
 * Les largeurs sont bornées à l'écriture ET à la lecture : un `localStorage`
 * bricolé à la main, ou une fenêtre devenue plus petite, ne doit pas pouvoir
 * produire un panneau inutilisable qu'on ne saurait plus rattraper.
 */

export interface LayoutBounds {
  min: number;
  max: number;
  default: number;
}

export const SIDEBAR_BOUNDS: LayoutBounds = { min: 190, max: 460, default: 248 };
export const PANEL_BOUNDS: LayoutBounds = { min: 260, max: 720, default: 340 };

function clamp(value: number, bounds: LayoutBounds): number {
  if (!Number.isFinite(value)) return bounds.default;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

function readNumber(key: string, bounds: LayoutBounds): number {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? bounds.default : clamp(Number.parseInt(raw, 10), bounds);
  } catch {
    return bounds.default;
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* mode privé, quota : une préférence perdue n'est pas une panne */
  }
}

export interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  panelWidth: number;
  panelCollapsed: boolean;
  setSidebarWidth: (width: number) => void;
  setPanelWidth: (width: number) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
}

export function useLayout(): LayoutState {
  const [sidebarWidth, setSidebarWidthRaw] = useState(() =>
    readNumber('bp.layout.sidebarWidth', SIDEBAR_BOUNDS),
  );
  const [panelWidth, setPanelWidthRaw] = useState(() =>
    readNumber('bp.layout.panelWidth', PANEL_BOUNDS),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readFlag('bp.layout.sidebarCollapsed'),
  );
  const [panelCollapsed, setPanelCollapsed] = useState(() =>
    readFlag('bp.layout.panelCollapsed'),
  );

  const setSidebarWidth = useCallback((width: number) => {
    const next = clamp(width, SIDEBAR_BOUNDS);
    setSidebarWidthRaw(next);
    persist('bp.layout.sidebarWidth', String(next));
  }, []);

  const setPanelWidth = useCallback((width: number) => {
    const next = clamp(width, PANEL_BOUNDS);
    setPanelWidthRaw(next);
    persist('bp.layout.panelWidth', String(next));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      persist('bp.layout.sidebarCollapsed', current ? '0' : '1');
      return !current;
    });
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsed((current) => {
      persist('bp.layout.panelCollapsed', current ? '0' : '1');
      return !current;
    });
  }, []);

  // Raccourcis de VS Code, parce qu'ils sont déjà dans les doigts de tout le
  // monde : Ctrl+B pour le flanc principal, Ctrl+Alt+B pour le secondaire.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return;
      event.preventDefault();
      if (event.altKey) togglePanel();
      else toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, togglePanel]);

  return {
    sidebarWidth,
    sidebarCollapsed,
    panelWidth,
    panelCollapsed,
    setSidebarWidth,
    setPanelWidth,
    toggleSidebar,
    togglePanel,
  };
}
