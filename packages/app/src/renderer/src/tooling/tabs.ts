/**
 * Onglets du panneau d'outillage — état pur, testable sans React.
 *
 * Le panneau était FIGÉ : un onglet par vue de plugin, non fermable, et le
 * même jeu pour toute l'application. Deux conséquences que Paul a relevées :
 * on ne pouvait pas ouvrir deux terminaux, et un terminal ouvert dans une
 * conversation réapparaissait dans une autre — donc dans le dossier du projet
 * précédent.
 *
 * Ici, les onglets sont OUVERTS par l'utilisateur (bouton `+`), fermables,
 * plusieurs par type quand le manifeste l'autorise, et rangés SOUS la
 * conversation. Le manifeste ne déclare plus des onglets : il déclare ce qu'on
 * PEUT ouvrir.
 */

import {
  localize,
  type BonaparteLocale,
  type PluginStatusDto,
} from '@aparte/bonaparte-shared';

/** Une vue ouvrable, telle que le manifeste d'un plugin la déclare. */
export interface ToolingViewDescriptor {
  pluginId: string;
  viewId: string;
  title: string;
  icon?: string;
  order: number;
  /** Plusieurs instances simultanées autorisées (deux terminaux, deux pages). */
  multiple: boolean;
  /** Accélérateur affiché dans le menu — indicatif, la fenêtre le câble. */
  shortcut?: string;
}

/**
 * What the active plugins can open, in the order they suggest, with every
 * title resolved for the locale — a tab title is a UI string like any other.
 */
export function listViews(
  plugins: PluginStatusDto[],
  locale: BonaparteLocale,
): ToolingViewDescriptor[] {
  return plugins
    .filter((plugin) => plugin.active)
    .flatMap((plugin) =>
      plugin.views.map((view) => ({
        pluginId: plugin.id,
        viewId: view.id,
        title: localize(view.title, locale),
        ...(view.icon ? { icon: view.icon } : {}),
        order: view.order ?? 100,
        multiple: view.multiple,
        ...(view.shortcut ? { shortcut: view.shortcut } : {}),
      })),
    )
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Un onglet ouvert. `instanceId` est l'identité de la session côté Node. */
export interface ToolingTab {
  instanceId: string;
  pluginId: string;
  viewId: string;
  title: string;
  icon?: string;
}

export interface ToolingTabsState {
  tabs: ToolingTab[];
  activeId: string | null;
  /**
   * Compteur MONOTONE des instances de cette conversation. Il est persisté :
   * un identifiant ne doit jamais être réattribué, sinon un onglet neuf
   * hériterait de la session que la moitié Node n'a pas encore libérée.
   */
  seq: number;
}

export const EMPTY_TABS: ToolingTabsState = { tabs: [], activeId: null, seq: 0 };

const STORAGE_PREFIX = 'bonaparte.tooling.';

/** Le sous-ensemble de `localStorage` qu'on utilise — pour pouvoir le feindre. */
export interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sameView(tab: ToolingTab, view: ToolingViewDescriptor): boolean {
  return tab.pluginId === view.pluginId && tab.viewId === view.viewId;
}

/**
 * Ouvre un onglet, ou ACTIVE l'existant quand la vue n'admet qu'une instance.
 * Réglages de conversation en double n'aurait aucun sens ; deux terminaux, si.
 */
export function openTab(
  state: ToolingTabsState,
  view: ToolingViewDescriptor,
): ToolingTabsState {
  if (!view.multiple) {
    const existing = state.tabs.find((tab) => sameView(tab, view));
    if (existing) return activateTab(state, existing.instanceId);
  }

  const seq = state.seq + 1;
  const tab: ToolingTab = {
    instanceId: `${view.pluginId}:${view.viewId}:${seq}`,
    pluginId: view.pluginId,
    viewId: view.viewId,
    title: view.title,
    ...(view.icon ? { icon: view.icon } : {}),
  };
  return { tabs: [...state.tabs, tab], activeId: tab.instanceId, seq };
}

/**
 * Ferme un onglet. L'actif passe à son voisin de DROITE — c'est ce que font
 * les navigateurs et les éditeurs : on continue vers l'avant.
 */
export function closeTab(state: ToolingTabsState, instanceId: string): ToolingTabsState {
  const index = state.tabs.findIndex((tab) => tab.instanceId === instanceId);
  if (index < 0) return state;

  const tabs = state.tabs.filter((tab) => tab.instanceId !== instanceId);
  if (tabs.length === 0) return { ...EMPTY_TABS, seq: state.seq };
  if (state.activeId !== instanceId) return { ...state, tabs };

  const next = tabs[index] ?? tabs[index - 1];
  return { ...state, tabs, activeId: next?.instanceId ?? null };
}

export function activateTab(
  state: ToolingTabsState,
  instanceId: string,
): ToolingTabsState {
  if (state.activeId === instanceId) return state;
  if (!state.tabs.some((tab) => tab.instanceId === instanceId)) return state;
  return { ...state, activeId: instanceId };
}

/**
 * Écarte les onglets dont la vue n'existe plus — plugin désactivé, retiré, ou
 * manifeste devenu invalide. Rend l'état INCHANGÉ quand il n'y a rien à
 * élaguer : cette fonction tourne à chaque rendu, un nouvel objet relancerait
 * l'écriture et les effets en boucle.
 */
export function pruneTabs(
  state: ToolingTabsState,
  views: ToolingViewDescriptor[],
): ToolingTabsState {
  const tabs = state.tabs.filter((tab) => views.some((view) => sameView(tab, view)));
  if (tabs.length === state.tabs.length) return state;
  if (tabs.length === 0) return { ...EMPTY_TABS, seq: state.seq };

  const active = tabs.some((tab) => tab.instanceId === state.activeId)
    ? state.activeId
    : (tabs[0]?.instanceId ?? null);
  return { ...state, tabs, activeId: active };
}

function isTab(value: unknown): value is ToolingTab {
  const tab = value as Partial<ToolingTab> | null;
  return (
    typeof tab === 'object' &&
    tab !== null &&
    typeof tab.instanceId === 'string' &&
    typeof tab.pluginId === 'string' &&
    typeof tab.viewId === 'string' &&
    typeof tab.title === 'string'
  );
}

/**
 * Relit les onglets d'une conversation. Toute anomalie — JSON cassé, forme
 * inattendue, stockage indisponible — rend un panneau VIDE : perdre des
 * onglets est bénin, refuser de démarrer ne l'est pas.
 */
export function readTabs(
  storage: TabStorage,
  conversationId: string | null,
): ToolingTabsState {
  if (!conversationId) return EMPTY_TABS;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_PREFIX + conversationId);
  } catch {
    return EMPTY_TABS;
  }
  if (!raw) return EMPTY_TABS;

  try {
    const parsed = JSON.parse(raw) as Partial<ToolingTabsState>;
    if (!Array.isArray(parsed.tabs) || !parsed.tabs.every(isTab)) return EMPTY_TABS;
    const active =
      typeof parsed.activeId === 'string' &&
      parsed.tabs.some((tab) => tab.instanceId === parsed.activeId)
        ? parsed.activeId
        : (parsed.tabs[0]?.instanceId ?? null);
    return {
      tabs: parsed.tabs,
      activeId: active,
      seq: typeof parsed.seq === 'number' ? parsed.seq : parsed.tabs.length,
    };
  } catch {
    return EMPTY_TABS;
  }
}

export function writeTabs(
  storage: TabStorage,
  conversationId: string | null,
  state: ToolingTabsState,
): void {
  if (!conversationId) return;
  try {
    if (state.tabs.length === 0 && state.seq === 0) {
      storage.removeItem(STORAGE_PREFIX + conversationId);
      return;
    }
    storage.setItem(STORAGE_PREFIX + conversationId, JSON.stringify(state));
  } catch {
    /* stockage indisponible : les onglets ne survivront pas, l'app oui */
  }
}
