/**
 * The panes beside the conversation (board « Conversation au travail »,
 * task 6.2): a column where the open panes stack — Fichiers, Changements,
 * then the terminal, 300 px high when another pane is open, the whole column
 * otherwise. Each has its header and its cross. In a narrow window (under
 * 1 100 px, board « Fenêtre étroite ») the pane goes over the conversation,
 * behind a scrim that closes it.
 */

import type { ReactNode } from 'react';
import type { Messages } from '../i18n/index';
import { Icon, type IconName } from '../shell/icons';
import { TipButton } from '../shell/TipButton';
import type { PaneName } from './panes';

const ICONS: Record<PaneName, IconName> = { files: 'file', changes: 'edit', subagents: 'subagents', terminal: 'terminal' };

export interface PaneContent {
  /** What the pane says after its title: a project, counts. */
  meta?: ReactNode;
  body: ReactNode;
}

export interface PanelDockProps {
  messages: Messages;
  /** The panes shown, in their order. */
  shown: readonly PaneName[];
  narrow: boolean;
  content: Partial<Record<PaneName, PaneContent>>;
  onClose(pane: PaneName): void;
  /** A page over the conversation (« À traiter »): the panes stay mounted, out of sight, a terminal view included. */
  hidden?: boolean;
}

export function PanelDock({ messages, shown, narrow, content, onClose, hidden = false }: PanelDockProps) {
  const words = messages.panels;
  if (shown.length === 0) return null;
  const others = shown.length > 1;
  return (
    <>
      {narrow && !hidden ? (
        <div className="bonaparte-panes__scrim" aria-hidden="true" onClick={() => shown.forEach((pane) => onClose(pane))} />
      ) : null}
      <div className={`bonaparte-panes${narrow ? ' bonaparte-panes--over' : ''}`} hidden={hidden}>
        {shown.map((pane) => {
          const name = words[pane];
          const what = content[pane];
          return (
            <section
              key={pane}
              aria-label={narrow ? words.over(name) : name}
              className={`bonaparte-pane bonaparte-pane--${pane}${pane === 'terminal' && others ? ' bonaparte-pane--fixed' : ''}`}
            >
              <header className="bonaparte-pane__header">
                <span className="bonaparte-pane__title">
                  <Icon name={ICONS[pane]} />
                  {name}
                </span>
                {what?.meta ? <span className="bonaparte-pane__meta">{what.meta}</span> : null}
                <span className="bonaparte-pane__spacer" />
                <TipButton label={words.close[pane]} tip={words.closeTip} icon="close" onClick={() => onClose(pane)} />
              </header>
              <div className="bonaparte-pane__body">{what?.body}</div>
            </section>
          );
        })}
      </div>
    </>
  );
}
