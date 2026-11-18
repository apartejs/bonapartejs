/**
 * The icons of the panes in the conversation's header (board « Conversation
 * au travail »): one per pane, named on hover and by its accessible name,
 * pressed while its pane is open. Changements carries a mark while changes
 * wait for the person — said in its name too, never by the colour alone.
 */

import type { Messages } from '../i18n/index';
import { TipButton } from '../shell/TipButton';
import type { IconName } from '../shell/icons';
import { PANES, type BuiltinPane, type OpenPanes, type PaneName } from './panes';

const ICONS: Record<BuiltinPane, IconName> = { files: 'file', changes: 'edit', subagents: 'subagents', browser: 'globe', terminal: 'terminal' };

export interface PanelTogglesProps {
  messages: Messages;
  open: OpenPanes;
  /** The changes that wait for the person, in the conversation open. */
  waiting: number;
  onToggle(pane: PaneName): void;
  /** The panes of plugins (task 11.2), after the app's own: their names as their manifests say them. */
  plugins?: readonly { pane: PaneName; label: string }[];
}

export function PanelToggles({ messages, open, waiting, onToggle, plugins = [] }: PanelTogglesProps) {
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
      {plugins.map(({ pane, label }) => (
        <TipButton key={pane} label={label} icon="panel" pressed={open.includes(pane)} onClick={() => onToggle(pane)} />
      ))}
    </div>
  );
}
