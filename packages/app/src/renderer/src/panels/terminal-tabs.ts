/**
 * The terminal's tabs (task 6.6): one per shell session, named after its
 * shell (« powershell », « powershell 2 »), and the agent's, which shows the
 * commands the agent runs. They live as long as the window: closing the
 * pane only detaches their views, the shells run on.
 */

export interface TerminalTab {
  /** The session's id, for the plugin. */
  instanceId: string;
  label: string;
  shellId: string | null;
}

export interface TerminalTabs {
  tabs: readonly TerminalTab[];
  active: string | null;
  /** Never reused, even after a tab is closed. */
  seq: number;
}

export const AGENT_TAB = 'agent';

export const NO_TABS: TerminalTabs = { tabs: [], active: null, seq: 0 };

/** A new tab on a shell: named after it, numbered from the second. */
export function openTab(state: TerminalTabs, shellId: string): TerminalTabs {
  const seq = state.seq + 1;
  const same = state.tabs.filter((tab) => tab.shellId === shellId).length;
  const tab: TerminalTab = { instanceId: `shell-${seq}`, label: same === 0 ? shellId : `${shellId} ${same + 1}`, shellId };
  return { tabs: [...state.tabs, tab], active: tab.instanceId, seq };
}

/** The agent's tab, once: it comes with the agent's first command. */
export function withAgentTab(state: TerminalTabs, label: string): TerminalTabs {
  if (state.tabs.some((tab) => tab.instanceId === AGENT_TAB)) return state;
  return { ...state, tabs: [...state.tabs, { instanceId: AGENT_TAB, label, shellId: null }], active: state.active ?? AGENT_TAB };
}

export function activate(state: TerminalTabs, instanceId: string): TerminalTabs {
  return state.tabs.some((tab) => tab.instanceId === instanceId) ? { ...state, active: instanceId } : state;
}
