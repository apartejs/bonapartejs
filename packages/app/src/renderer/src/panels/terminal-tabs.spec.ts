/** The terminal's tabs: named after their shell, numbered; the agent's, once. */

import { describe, expect, it } from 'vitest';
import { activate, AGENT_TAB, NO_TABS, openTab, withAgentTab } from './terminal-tabs';

describe('the terminal tabs', () => {
  it('a new tab is named after its shell, numbered from the second, and shown', () => {
    const one = openTab(NO_TABS, 'powershell');
    const two = openTab(one, 'powershell');
    const three = openTab(two, 'cmd');
    expect(three.tabs.map((tab) => tab.label)).toEqual(['powershell', 'powershell 2', 'cmd']);
    expect(three.tabs.map((tab) => tab.instanceId)).toEqual(['shell-1', 'shell-2', 'shell-3']);
    expect(three.active).toBe('shell-3');
    expect(activate(three, 'shell-1').active).toBe('shell-1');
    expect(activate(three, 'nope')).toBe(three);
  });

  it('the agent’s tab comes once, shown only when nothing else was', () => {
    const agent = withAgentTab(NO_TABS, 'agent');
    expect(agent.tabs).toEqual([{ instanceId: AGENT_TAB, label: 'agent', shellId: null }]);
    expect(agent.active).toBe(AGENT_TAB);
    expect(withAgentTab(agent, 'agent')).toBe(agent);
    const shell = openTab(NO_TABS, 'bash');
    expect(withAgentTab(shell, 'agent').active).toBe('shell-1');
  });
});
