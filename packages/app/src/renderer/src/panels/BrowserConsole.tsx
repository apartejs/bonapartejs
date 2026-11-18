/**
 * The console of the tab shown (task 10.2, board « Le navigateur et ses outils »): folded under the page, its
 * errors and warnings counted; unfolded, its lines, and « Joindre les erreurs à la conversation » — a pill in the
 * composer that says them in full.
 */

import { browserConsole, type BrowserTabView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

type ConsoleLine = { level: 'error' | 'warning' | 'info' | 'debug'; text: string; source: string };

export interface BrowserConsoleProps {
  messages: Messages;
  tab: BrowserTabView;
  /** Puts the errors into the message the person writes. */
  onAttach(lines: readonly string[]): void;
}

/** A line as the agent reads it: its text, where it comes from. */
export const lineOf = (line: ConsoleLine): string => (line.source ? `${line.text} · ${line.source}` : line.text);

export function BrowserConsole({ messages, tab, onAttach }: BrowserConsoleProps) {
  const words = messages.browser.console;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);

  // Read again whenever the tab says its counts changed, while the console is open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void bridge.invoke(browserConsole, { tabId: tab.tabId }).then((read) => {
      if (live) setLines(read);
    });
    return () => {
      live = false;
    };
  }, [open, tab.tabId, tab.errors, tab.warnings, tab.url]);

  const shown = lines.filter((line) => line.level === 'error' || line.level === 'warning');
  const errors = lines.filter((line) => line.level === 'error');

  return (
    <section className="browser-console" aria-label={words.title}>
      <button type="button" className="browser-console__toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Icon name="terminal" />
        <span className="browser-console__title">{words.title}</span>
        {tab.errors > 0 ? <span className="aparte-badge aparte-badge--danger aparte-badge--soft aparte-badge--sm">{words.errors(tab.errors)}</span> : null}
        {tab.warnings > 0 ? (
          <span className="aparte-badge aparte-badge--warning aparte-badge--soft aparte-badge--sm">{words.warnings(tab.warnings)}</span>
        ) : null}
        <span className="browser-console__spacer" />
        <Icon name={open ? 'chevronDown' : 'chevronUp'} />
      </button>
      {open ? (
        <div className="browser-console__body">
          {shown.length === 0 ? <p className="browser-console__empty">{words.empty}</p> : null}
          {shown.map((line, index) => (
            <div key={index} className={`browser-console__line browser-console__line--${line.level}`} data-console-level={line.level}>
              <span className="browser-console__level">{line.level === 'error' ? words.error : words.warning}</span>
              {lineOf(line)}
            </div>
          ))}
          {errors.length > 0 ? (
            <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm browser-console__attach" onClick={() => onAttach(errors.map(lineOf))}>
              {words.attach}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
