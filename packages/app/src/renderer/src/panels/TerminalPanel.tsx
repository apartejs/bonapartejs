/**
 * The terminal (board « Conversation au travail », task 6.6): a tab per
 * shell session — the plugin's, in a process of the app's own — and the
 * agent's tab, which shows the commands the agent runs. Each tab is an
 * emulator (xterm.js) that reads the shell's bytes raw; it acknowledges
 * what it has shown in `term.write`'s callback, so the shell's output is
 * held, not lost, while the view is behind. A view that goes away detaches;
 * its shell runs on, and its history redraws it when it comes back.
 *
 * The tabs are aparté's kit, with its keyboard (`enhanceTabs`); the pane is
 * dark in either theme, as the board draws it.
 */

import { pluginsAck, pluginsInvoke } from '@aparte/bonaparte-shared';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useTabs } from '../aparte/kit';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { TipButton } from '../shell/TipButton';
import type { AgentOutput } from './agent-output';
import { activate, AGENT_TAB, type TerminalTab, type TerminalTabs } from './terminal-tabs';

/** What is acknowledged at once: the host's packet (VS Code's thresholds). */
const ACK_CHARS = 5_000;
const PLUGIN = 'terminal';

const invoke = (command: string, payload: unknown): Promise<unknown> => bridge.invoke(pluginsInvoke, { pluginId: PLUGIN, action: command, payload });

/** The emulator's colours, read from the tokens. */
function themeOf(element: Element): ITheme {
  const style = getComputedStyle(element);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    background: token('--bonaparte-terminal-bg'),
    foreground: token('--bonaparte-terminal-ink'),
    cursor: token('--bonaparte-terminal-ink'),
    selectionBackground: token('--bonaparte-terminal-bar'),
  };
}

function emulator(host: HTMLElement, readOnly: boolean): { term: Terminal; fit: () => void } {
  const style = getComputedStyle(host);
  const term = new Terminal({
    fontFamily: style.getPropertyValue('--aparte-code-font-family').trim() || 'monospace',
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: !readOnly,
    disableStdin: readOnly,
    theme: themeOf(host),
  });
  const addon = new FitAddon();
  term.loadAddon(addon);
  term.open(host);
  const fit = (): void => {
    // A hidden tab has no size: it is fitted when it shows.
    if (host.offsetWidth > 0 && host.offsetHeight > 0) addon.fit();
  };
  fit();
  return { term, fit };
}

/** A shell's tab: the emulator, wired to its session. */
function ShellView({ tab, cwd, messages }: { tab: TerminalTab; cwd: string | null; messages: Messages }) {
  const host = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const words = messages.terminal;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setExited(false);
    const { term, fit } = emulator(element, false);
    const { instanceId } = tab;
    let unacked = 0;
    let ready = false;
    const early: string[] = [];
    const show = (chunk: string): void => {
      term.write(chunk, () => {
        unacked += chunk.length;
        if (unacked >= ACK_CHARS) {
          void bridge.invoke(pluginsAck, { pluginId: PLUGIN, instanceId, chars: unacked }).catch(() => undefined);
          unacked = 0;
        }
      });
    };
    const off = bridge.on((event) => {
      if (event.kind !== 'plugin' || event.pluginId !== PLUGIN || event.instanceId !== instanceId) return;
      if (event.event === 'data' && typeof event.payload === 'string') {
        if (ready) show(event.payload);
        else early.push(event.payload);
      } else if (event.event === 'exit') setExited(true);
    });
    const typed = term.onData((data) => void invoke('write', { instanceId, data }).catch(() => undefined));
    void invoke('open', { instanceId, shellId: tab.shellId, cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}) })
      .then((result) => {
        const opened = result as { history?: string; error?: string };
        if (opened.error) {
          term.write(`${words.noShell}\r\n`);
          return;
        }
        // What the shell printed while no view was there, then what came during the opening.
        if (opened.history) term.write(opened.history);
        ready = true;
        for (const chunk of early.splice(0)) show(chunk);
      })
      .catch(() => undefined);
    const observer = new ResizeObserver(() => {
      fit();
      void invoke('resize', { instanceId, cols: term.cols, rows: term.rows }).catch(() => undefined);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      off();
      typed.dispose();
      void invoke('detach', { instanceId }).catch(() => undefined);
      term.dispose();
    };
    // A restart opens the session again; nothing else does.
    // `cwd` and the words are read when the session opens.
  }, [tab.instanceId, attempt]);

  return (
    <div className="terminal-pane__view">
      <div ref={host} className="terminal-pane__host" role="log" aria-label={words.output(tab.label)} />
      {exited ? (
        <div className="terminal-pane__ended" role="status">
          <span>{words.exited}</span>
          <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" onClick={() => setAttempt((count) => count + 1)}>
            {words.restart}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The agent's tab: what its commands printed, read-only. */
function AgentView({ agent, messages }: { agent: AgentOutput; messages: Messages }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const { term, fit } = emulator(element, true);
    term.write(agent.text());
    const off = agent.subscribe((piece) => term.write(piece));
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      off();
      term.dispose();
    };
  }, [agent]);
  return (
    <div className="terminal-pane__view">
      <div ref={host} className="terminal-pane__host" role="log" aria-label={messages.terminal.output(messages.terminal.agent)} />
    </div>
  );
}

export interface TerminalPanelProps {
  messages: Messages;
  tabs: TerminalTabs;
  onTabs(change: (tabs: TerminalTabs) => TerminalTabs): void;
  /** A new tab on the default shell. */
  onNewTab(): void;
  /** Where a new shell opens: the project's folder. */
  cwd: string | null;
  agent: AgentOutput;
}

export function TerminalPanel({ messages, tabs, onTabs, onNewTab, cwd, agent }: TerminalPanelProps) {
  const words = messages.terminal;
  const list = useRef<HTMLDivElement>(null);
  useTabs(list);
  // aparté's keyboard moves the selection; React keeps it.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const changed = (event: Event): void => {
      const tab = (event as CustomEvent<{ tab: HTMLElement }>).detail?.tab;
      const id = tab?.dataset['instance'];
      event.preventDefault();
      if (id) onTabs((was) => activate(was, id));
    };
    element.addEventListener('aparte-tab-change', changed);
    return () => element.removeEventListener('aparte-tab-change', changed);
  }, [onTabs]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane__bar">
        <div ref={list} role="tablist" aria-label={words.tabs} className="aparte-tabs terminal-pane__tabs">
          {tabs.tabs.map((tab) => (
            <button
              key={tab.instanceId}
              type="button"
              role="tab"
              id={`terminal-tab-${tab.instanceId}`}
              aria-controls={`terminal-panel-${tab.instanceId}`}
              aria-selected={tab.instanceId === tabs.active}
              tabIndex={tab.instanceId === tabs.active ? 0 : -1}
              data-instance={tab.instanceId}
              className="aparte-tabs__tab terminal-pane__tab"
              onClick={() => onTabs((was) => activate(was, tab.instanceId))}
            >
              {tab.instanceId === AGENT_TAB ? <span className="terminal-pane__agent-dot" role="img" aria-label={words.byAgent} /> : null}
              {tab.label}
            </button>
          ))}
        </div>
        <TipButton label={words.newTab} icon="plus" className="terminal-pane__new" onClick={onNewTab} />
      </div>
      {tabs.tabs.map((tab) => (
        <div
          key={tab.instanceId}
          role="tabpanel"
          id={`terminal-panel-${tab.instanceId}`}
          aria-labelledby={`terminal-tab-${tab.instanceId}`}
          hidden={tab.instanceId !== tabs.active}
          className="terminal-pane__panel"
        >
          {tab.instanceId === AGENT_TAB ? <AgentView agent={agent} messages={messages} /> : <ShellView tab={tab} cwd={cwd} messages={messages} />}
        </div>
      ))}
    </div>
  );
}
