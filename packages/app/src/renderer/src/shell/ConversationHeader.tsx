/**
 * The conversation's header (board « Conversation au travail », §8.1): its
 * title, its project, where its memory is, and « Plus d’actions » — rename,
 * pin, archive, delete. The menu is the kit's, driven by aparté's keyboard
 * (`useMenu`). The branch, the lines changed, « Brancher » and the panes come
 * with their tasks (6.2, 6.7, 7.2).
 */

import type { ConversationStatusView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMenu } from '../aparte/kit';
import type { Messages } from '../i18n/index';
import { Icon } from './icons';

export interface ConversationHeaderProps {
  messages: Messages;
  /** null: a new conversation, nothing said yet — no actions. */
  conversationId: string | null;
  title: string;
  project: string | null;
  memory: ConversationStatusView['memory'];
  pinned: boolean;
  onRename(title: string): void;
  onPin(): void;
  onUnpin(): void;
  onArchive(): void;
  onDelete(): void;
  /** The icons of the panes, at the end of the header. */
  panels?: ReactNode;
  /** The lines the conversation changed (« +4 −4 »): a click opens « Changements ». */
  counts?: { added: number; removed: number; onOpen(): void } | null;
}

type Action = 'rename' | 'pin' | 'unpin' | 'archive' | 'delete';

export function ConversationHeader(props: ConversationHeaderProps) {
  const words = props.messages.header;
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const questionId = useId();
  useMenu(trigger, menu, { align: 'end' }, props.conversationId !== null);

  // What an item of the menu does; aparté says which one was chosen.
  const act = useRef<(action: Action) => void>(() => undefined);
  act.current = (action) => {
    if (action === 'rename') setRenaming(true);
    else if (action === 'pin') props.onPin();
    else if (action === 'unpin') props.onUnpin();
    else if (action === 'archive') props.onArchive();
    else setDeleting(true);
  };
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const chosen = (event: Event): void => {
      const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
      const action = item.dataset['action'] as Action | undefined;
      if (action) act.current(action);
    };
    element.addEventListener('aparte-menu-select', chosen);
    return () => element.removeEventListener('aparte-menu-select', chosen);
  }, [props.conversationId]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (deleting && !element.open) element.showModal();
    if (!deleting && element.open) element.close();
  }, [deleting]);

  const title = props.title || props.messages.search.untitled;
  return (
    <header className="aparte-app-header conversation-header">
      {renaming ? (
        <input
          className="aparte-field conversation-header__field"
          aria-label={words.titleField}
          defaultValue={props.title}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const next = event.currentTarget.value.trim();
              if (next && next !== props.title) props.onRename(next);
              setRenaming(false);
            } else if (event.key === 'Escape') {
              setRenaming(false);
            }
          }}
          onBlur={() => setRenaming(false)}
        />
      ) : (
        <h1 className="aparte-app-header__title conversation-header__title">{title}</h1>
      )}
      {props.project ? (
        <span className="conversation-header__chip">
          <Icon name="folder" />
          {props.project}
        </span>
      ) : null}
      {props.counts ? (
        <button
          type="button"
          className="aparte-btn aparte-btn--ghost aparte-btn--sm conversation-header__counts"
          aria-label={props.messages.changes.headerCounts(props.counts.added, props.counts.removed)}
          onClick={props.counts.onOpen}
        >
          <span className="changes-pane__added">{props.messages.changes.added(props.counts.added)}</span>
          <span className="changes-pane__removed">{props.messages.changes.removed(props.counts.removed)}</span>
        </button>
      ) : null}
      <span className="conversation-header__spacer" />
      {props.memory ? (
        <span className={`conversation-header__memory conversation-header__memory--${props.memory}`}>
          <span className="conversation-header__memory-dot" aria-hidden="true" />
          {props.messages.shell.memory[props.memory]}
        </span>
      ) : null}
      {props.conversationId ? (
        <span className="aparte-app-header__actions conversation-header__more">
          <button
            ref={trigger}
            type="button"
            className="aparte-btn aparte-btn--icon aparte-btn--ghost bonaparte-icon-button bonaparte-bordered"
            aria-label={words.more}
            title={words.more}
          >
            <Icon name="more" />
          </button>
          <div ref={menu} className="aparte-menu" role="menu" aria-label={words.more} hidden>
            <button type="button" className="aparte-menu__item" role="menuitem" data-action="rename">
              {words.rename}
            </button>
            <button type="button" className="aparte-menu__item" role="menuitem" data-action={props.pinned ? 'unpin' : 'pin'}>
              {props.pinned ? words.unpin : words.pin}
            </button>
            <button type="button" className="aparte-menu__item" role="menuitem" data-action="archive">
              {words.archive}
            </button>
            <div className="aparte-menu__separator" role="separator" />
            <button type="button" className="aparte-menu__item conversation-header__danger" role="menuitem" data-action="delete">
              {words.delete}
            </button>
          </div>
        </span>
      ) : null}
      {props.panels ? (
        <>
          <span className="conversation-header__divider" aria-hidden="true" />
          {props.panels}
        </>
      ) : null}
      <dialog ref={dialog} className="aparte-dialog conversation-delete" aria-labelledby={questionId} onClose={() => setDeleting(false)}>
        <header className="aparte-dialog__header">
          <h2 id={questionId} className="aparte-dialog__title">
            {words.deleteQuestion(title)}
          </h2>
        </header>
        <div className="aparte-dialog__body">
          <p>{words.deleteWhat}</p>
        </div>
        <footer className="aparte-dialog__footer">
          <button type="button" className="aparte-btn aparte-btn--ghost" onClick={() => setDeleting(false)}>
            {words.cancel}
          </button>
          <button
            type="button"
            className="aparte-btn aparte-btn--danger aparte-btn--solid"
            onClick={() => {
              setDeleting(false);
              props.onDelete();
            }}
          >
            {words.confirmDelete}
          </button>
        </footer>
      </dialog>
    </header>
  );
}
