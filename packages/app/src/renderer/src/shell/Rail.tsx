/**
 * The sidebar folded into a column of icons (Ctrl B, or a window narrower
 * than 1 100 px — board « Fenêtre étroite », §8.1): unfold, a new
 * conversation, « Rechercher »; the conversation open and those that wait for
 * the person; the engine. Each icon is named, and shows its name on hover.
 * aparté's rail (`collapsed="rail"`) folds the sidebar's own children; this
 * one shows others (the conversations that wait, the engine's mark): kit
 * buttons.
 */

import type { EngineStateView } from '@aparte/bonaparte-shared';
import type { Messages } from '../i18n/index';
import type { ListedConversation } from './Sidebar';
import { Icon } from './icons';
import type { Statuses } from './statuses';
import { TipButton } from './TipButton';

export interface RailProps {
  messages: Messages;
  engine: EngineStateView;
  conversations: readonly ListedConversation[];
  activeId: string | null;
  statuses: Statuses;
  onExpand(): void;
  onNewConversation(): void;
  onSearch(): void;
  onOpen(id: string): void;
  onSettings(): void;
}

export function Rail(props: RailProps) {
  const { messages, conversations, activeId, statuses } = props;
  const words = messages.shell;
  const shown = conversations.filter((conversation) => conversation.id === activeId || statuses[conversation.id]?.waiting);
  return (
    <nav className="bonaparte-rail" aria-label={words.navCollapsed}>
      <TipButton label={words.expand} tip={words.expandTip} icon="panel" side="end" onClick={props.onExpand} />
      <TipButton label={words.newConversation} icon="plus" side="end" className="bonaparte-bordered" onClick={props.onNewConversation} />
      <TipButton label={messages.search.open} tip={words.searchTip} icon="search" side="end" onClick={props.onSearch} />
      {shown.length > 0 ? <span className="bonaparte-rail__separator" role="separator" /> : null}
      {shown.map((conversation) => {
        const waiting = statuses[conversation.id]?.waiting === true;
        const title = conversation.title || messages.search.untitled;
        return (
          <TipButton
            key={conversation.id}
            label={words.railConversation(title, waiting)}
            icon="conversation"
            side="end"
            current={conversation.id === activeId}
            badge={waiting ? <span className="aparte-badge aparte-badge--dot aparte-badge--warning bonaparte-rail__badge" aria-hidden="true" /> : null}
            onClick={() => props.onOpen(conversation.id)}
          />
        );
      })}
      <span className="bonaparte-rail__spacer" />
      {props.engine.model ? (
        // A mark, not a button, until « Moteur et mémoire » (5.7) gives it a page to open.
        <span className="aparte-tooltip-anchor aparte-tooltip-anchor--hover bonaparte-tip" data-side="end">
          <span className="bonaparte-icon-button bonaparte-rail__engine" role="img" aria-label={words.engine(props.engine.model.name)}>
            <Icon name="engine" />
            <span className="aparte-badge aparte-badge--dot aparte-badge--success bonaparte-rail__badge" aria-hidden="true" />
          </span>
          <span className="aparte-tooltip" aria-hidden="true">
            {words.engine(props.engine.model.name)}
          </span>
        </span>
      ) : null}
      <TipButton label={messages.settings.open} icon="settings" side="end" onClick={props.onSettings} />
    </nav>
  );
}
