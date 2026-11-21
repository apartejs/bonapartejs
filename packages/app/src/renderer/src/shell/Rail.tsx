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
import { Mascot } from '../logo/Mascot';
import type { MascotState } from '../logo/mascot-state';

export interface RailProps {
  messages: Messages;
  /** The mascot's state (task 12.2). */
  mascot: MascotState;
  engine: EngineStateView;
  conversations: readonly ListedConversation[];
  activeId: string | null;
  statuses: Statuses;
  /** The conversations that answer now (aparté's `running`), and those whose turn waits for the engine (audit C3, C1). */
  running: ReadonlySet<string>;
  queued: ReadonlySet<string>;
  onExpand(): void;
  onNewConversation(): void;
  /** « Nouvelle discussion » (task 9.7): a conversation without a project, offered folded too (review of phase 9). */
  onNewDiscussion?(): void;
  onSearch(): void;
  onOpen(id: string): void;
  onSettings(): void;
  /** « Mises à jour » (task 13.1): shown only when one is ready. */
  updates?: { count: number; onOpen(): void };
}

type RailState = 'waiting' | 'queued' | 'running' | 'unread' | null;

/** The kit's tone of each state's dot: what waits for the person in its amber, a reply not read in the accent. */
const BADGES: Record<Exclude<RailState, null>, string> = { waiting: 'warning', queued: 'neutral', running: 'info', unread: 'primary' };

export function Rail(props: RailProps) {
  const { messages, conversations, activeId, statuses, running, queued } = props;
  const words = messages.shell;
  // What a conversation does, the most pressing first: it waits for the person, for the engine, it answers, or a
  // reply waits to be read (audit C3) — never « unread » for the one open.
  const stateOf = (id: string): RailState => {
    if (statuses[id]?.waiting) return 'waiting';
    if (queued.has(id)) return 'queued';
    if (running.has(id)) return 'running';
    if (statuses[id]?.unread && id !== activeId) return 'unread';
    return null;
  };
  const shown = conversations.filter((conversation) => conversation.id === activeId || stateOf(conversation.id) !== null);
  return (
    <nav className="bonaparte-rail" aria-label={words.navCollapsed}>
      <Mascot className="bonaparte-rail__mark" state={props.mascot} label={words.mascot.label(words.mascot.states[props.mascot])} />
      <TipButton label={words.expand} tip={words.expandTip} icon="panel" side="end" onClick={props.onExpand} />
      <TipButton label={words.newConversation} icon="plus" side="end" className="bonaparte-bordered" onClick={props.onNewConversation} />
      {props.onNewDiscussion ? <TipButton label={words.newDiscussion} icon="conversation" side="end" onClick={props.onNewDiscussion} /> : null}
      <TipButton label={messages.search.open} tip={words.searchTip} icon="search" side="end" onClick={props.onSearch} />
      {shown.length > 0 ? <span className="bonaparte-rail__separator" role="separator" /> : null}
      {shown.map((conversation) => {
        const state = stateOf(conversation.id);
        const title = conversation.title || messages.search.untitled;
        return (
          <TipButton
            key={conversation.id}
            label={words.railConversation(title, state)}
            icon="conversation"
            side="end"
            current={conversation.id === activeId}
            badge={
              state ? (
                <span className={`aparte-badge aparte-badge--dot aparte-badge--${BADGES[state]} bonaparte-rail__badge`} data-state={state} aria-hidden="true" />
              ) : null
            }
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
      {props.updates && props.updates.count > 0 ? (
        <TipButton label={messages.updates.openCount(props.updates.count)} icon="update" side="end" className="bonaparte-updates-link" onClick={props.updates.onOpen} />
      ) : null}
      <TipButton label={messages.settings.open} icon="settings" side="end" onClick={props.onSettings} />
    </nav>
  );
}
