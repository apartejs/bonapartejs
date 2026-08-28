import { useCallback, useEffect, useState } from 'react';

/**
 * Shell layout: widths and collapse state of both flanks.
 *
 * This is a DISPLAY preference, hence local — routing it through IPC would
 * restart the main process for a panel someone is dragging with the mouse,
 * and restarting reloads the model into VRAM. The trade-off would be absurd.
 *
 * Widths are bounded both on write AND on read: a `localStorage` hand-edited
 * by hand, or a window that has become smaller, must not be able to produce
 * an unusable panel that can no longer be recovered.
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
    /* private mode, quota: a lost preference isn't a failure */
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
  /**
   * Expands the panel if it's collapsed. Opening a tab must show it: a
   * terminal opened behind a closed panel doesn't exist to the eye.
   */
  expandPanel: () => void;
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

  const expandPanel = useCallback(() => {
    setPanelCollapsed((current) => {
      if (!current) return current;
      persist('bp.layout.panelCollapsed', '0');
      return false;
    });
  }, []);

  // VS Code's shortcuts, because they're already in everyone's fingers:
  // Ctrl+B for the primary flank, Ctrl+Alt+B for the secondary one.
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
    expandPanel,
  };
}
