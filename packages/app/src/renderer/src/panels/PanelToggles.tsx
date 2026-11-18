/**
 * The icons of the panes in the conversation's header (board « Conversation
 * au travail »): one per pane, named on hover and by its accessible name,
 * pressed while its pane is open. Changements carries a mark while changes
 * wait for the person — said in its name too, never by the colour alone.
 */

import type { Messages } from '../i18n/index';
import { TipButton } from '../shell/TipButton';
import type { IconName } from '../shell/icons';
import { PANES, type OpenPanes, type PaneName } from './panes';

const ICONS: Record<PaneName, IconName> = { files: 'file', changes: 'edit', subagents: 'subagents', browser: 'globe', terminal: 'terminal' };

export interface PanelTogglesProps {
  messages: Messages;
  open: OpenPanes;
  /** The changes that wait for the person, in the conversation open. */
  waiting: number;
  onToggle(pane: PaneName): void;
}

export function PanelToggles({ messages, open, waiting, onToggle }: PanelTogglesProps) {
  const words = messages.panels;
  return (
    <div role="group" aria-label={words.group} className="aparte-btn-group panel-toggles">
      {PANES.map((pane) => {
        const name = words[pane];
        const marked = pane === 'changes' && waiting > 0;
        return (
          <TipButton
            key={pane}
            label={marked ? words.changesWaiting(waiting) : name}
            tip={name}
            icon={ICONS[pane]}
            pressed={open.includes(pane)}
            badge={marked ? <span className="aparte-badge aparte-badge--dot aparte-badge--warning panel-toggles__mark" aria-hidden="true" /> : null}
            onClick={() => onToggle(pane)}
          />
        );
      })}
    </div>
  );
}
