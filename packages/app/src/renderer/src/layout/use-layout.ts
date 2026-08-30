import { useCallback, useEffect, useState } from 'react';

/**
 * Shell layout: widths and open/closed state of both flanks, responsive.
 *
 * A window gets dragged narrow, so the flanks adapt. Above a width they are
 * DOCKED — they take a resizable column beside the chat, as a desktop app
 * does. Below it they become a DRAWER — an overlay over the chat with a
 * scrim, so the chat keeps its full width whatever the window size. The
 * sidebar undocks before the panel: reading conversations matters more in a
 * cramped window than the tooling on the side.
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

/**
 * Below these window widths, a flank stops docking and becomes a drawer. The
 * sidebar holds on longer than the panel: a narrow window still wants its
 * conversations reachable, the tooling can wait behind a scrim.
 */
const SIDEBAR_DOCK_MIN = 720;
const PANEL_DOCK_MIN = 1024;

/** A drawer's width — capped to the viewport so it never overflows a phone-narrow window. */
export const DRAWER_MAX = 320;

type FlankMode = 'docked' | 'drawer';

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

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth;
}

export interface FlankState {
  /** 'docked' beside the chat (resizable), 'drawer' over it (overlay). */
  mode: FlankMode;
  /** Is the flank on screen right now? Docked-not-collapsed, or an open drawer. */
  visible: boolean;
  /** Width to apply to the slot: 0 when a docked flank is collapsed, the drawer width otherwise. */
  slotWidth: number;
  /** Dock width (for the resize handle bounds); meaningless in drawer mode. */
  width: number;
}

export interface LayoutState {
  sidebar: FlankState;
  panel: FlankState;
  setSidebarWidth: (width: number) => void;
  setPanelWidth: (width: number) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  /**
   * Expands the panel if it's closed. Opening a tab must show it: a terminal
   * opened behind a closed panel doesn't exist to the eye. In drawer mode it
   * opens the drawer.
   */
  expandPanel: () => void;
  /** A drawer is open over the chat: the scrim shows, a click on it closes. */
  anyDrawerOpen: boolean;
  closeDrawers: () => void;
}

export function useLayout(): LayoutState {
  const [sidebarWidth, setSidebarWidthRaw] = useState(() =>
    readNumber('bp.layout.sidebarWidth', SIDEBAR_BOUNDS),
  );
  const [panelWidth, setPanelWidthRaw] = useState(() =>
    readNumber('bp.layout.panelWidth', PANEL_BOUNDS),
  );
  // Docked collapse — the desktop preference, persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readFlag('bp.layout.sidebarCollapsed'),
  );
  const [panelCollapsed, setPanelCollapsed] = useState(() =>
    readFlag('bp.layout.panelCollapsed'),
  );
  // Drawer open — transient, never persisted: a narrow window opens closed.
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [panelDrawerOpen, setPanelDrawerOpen] = useState(false);
  const [width, setWidth] = useState(viewportWidth);

  // The window is resizable: follow it, so the flanks dock and undock live.
  useEffect(() => {
    const onResize = (): void => setWidth(viewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sidebarDocked = width >= SIDEBAR_DOCK_MIN;
  const panelDocked = width >= PANEL_DOCK_MIN;

  // Widening back to docked closes any drawer that was open, so the flank
  // returns to its docked preference rather than lingering as an overlay.
  useEffect(() => {
    if (sidebarDocked && sidebarDrawerOpen) setSidebarDrawerOpen(false);
  }, [sidebarDocked, sidebarDrawerOpen]);
  useEffect(() => {
    if (panelDocked && panelDrawerOpen) setPanelDrawerOpen(false);
  }, [panelDocked, panelDrawerOpen]);

  const setSidebarWidth = useCallback((next: number) => {
    const value = clamp(next, SIDEBAR_BOUNDS);
    setSidebarWidthRaw(value);
    persist('bp.layout.sidebarWidth', String(value));
  }, []);

  const setPanelWidth = useCallback((next: number) => {
    const value = clamp(next, PANEL_BOUNDS);
    setPanelWidthRaw(value);
    persist('bp.layout.panelWidth', String(value));
  }, []);

  const toggleSidebar = useCallback(() => {
    if (viewportWidth() >= SIDEBAR_DOCK_MIN) {
      setSidebarCollapsed((current) => {
        persist('bp.layout.sidebarCollapsed', current ? '0' : '1');
        return !current;
      });
    } else {
      setSidebarDrawerOpen((open) => !open);
    }
  }, []);

  const togglePanel = useCallback(() => {
    if (viewportWidth() >= PANEL_DOCK_MIN) {
      setPanelCollapsed((current) => {
        persist('bp.layout.panelCollapsed', current ? '0' : '1');
        return !current;
      });
    } else {
      setPanelDrawerOpen((open) => !open);
    }
  }, []);

  const expandPanel = useCallback(() => {
    if (viewportWidth() >= PANEL_DOCK_MIN) {
      setPanelCollapsed((current) => {
        if (!current) return current;
        persist('bp.layout.panelCollapsed', '0');
        return false;
      });
    } else {
      setPanelDrawerOpen(true);
    }
  }, []);

  const closeDrawers = useCallback(() => {
    setSidebarDrawerOpen(false);
    setPanelDrawerOpen(false);
  }, []);

  // VS Code's shortcuts, because they're already in everyone's fingers:
  // Ctrl+B for the primary flank, Ctrl+Alt+B for the secondary one. Escape
  // closes an open drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && (sidebarDrawerOpen || panelDrawerOpen)) {
        closeDrawers();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return;
      event.preventDefault();
      if (event.altKey) togglePanel();
      else toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, togglePanel, closeDrawers, sidebarDrawerOpen, panelDrawerOpen]);

  const sidebarVisible = sidebarDocked ? !sidebarCollapsed : sidebarDrawerOpen;
  const panelVisible = panelDocked ? !panelCollapsed : panelDrawerOpen;
  const drawerWidth = Math.min(DRAWER_MAX, Math.round(width * 0.85));

  return {
    sidebar: {
      mode: sidebarDocked ? 'docked' : 'drawer',
      visible: sidebarVisible,
      slotWidth: sidebarDocked ? (sidebarCollapsed ? 0 : sidebarWidth) : drawerWidth,
      width: sidebarWidth,
    },
    panel: {
      mode: panelDocked ? 'docked' : 'drawer',
      visible: panelVisible,
      slotWidth: panelDocked ? (panelCollapsed ? 0 : panelWidth) : drawerWidth,
      width: panelWidth,
    },
    setSidebarWidth,
    setPanelWidth,
    toggleSidebar,
    togglePanel,
    expandPanel,
    anyDrawerOpen: (!sidebarDocked && sidebarDrawerOpen) || (!panelDocked && panelDrawerOpen),
    closeDrawers,
  };
}
