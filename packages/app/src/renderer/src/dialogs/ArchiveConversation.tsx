/**
 * Archiving a conversation whose branch has changes not committed (board
 * « Branches et conversations », task 6.8): « Annuler », « Archiver quand
 * même », or « Commiter d'abord ». Archived, it keeps its folder and its
 * branch 30 days. Its commits neither pushed nor merged are said too: kept
 * after those days, the branch with them (audit D8) — « Archiver » alone
 * when nothing else is to commit.
 */

import { useEffect, useId, useRef } from 'react';
import type { Messages } from '../i18n/index';

export interface ArchiveConversationProps {
  messages: Messages;
  /** The conversation asked about, and what its branch has not committed; null: closed. */
  asking: { title: string; uncommitted: number; unsaved: number | null } | null;
  onCancel(): void;
  onArchive(): void;
  onCommitFirst(): void;
}

export function ArchiveConversation({ messages, asking, onCancel, onArchive, onCommitFirst }: ArchiveConversationProps) {
  const words = messages.pr;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);
  return (
    <dialog ref={dialog} className="aparte-dialog archive-conversation" aria-labelledby={titleId} onClose={onCancel}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {asking ? words.archiveQuestion(asking.title) : ''}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        {asking && asking.uncommitted > 0 ? <p>{words.uncommitted(asking.uncommitted)}</p> : null}
        {asking && asking.unsaved !== 0 ? <p className="archive-conversation__kept">{words.unsaved(asking.unsaved)}</p> : null}
        <p className="aparte-field-hint">{words.archiveNote}</p>
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" onClick={onCancel}>
          {words.cancel}
        </button>
        {asking && asking.uncommitted === 0 ? (
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onArchive}>
            {words.archive}
          </button>
        ) : (
          <>
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={onArchive}>
              {words.archiveAnyway}
            </button>
            <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onCommitFirst}>
              {words.commitFirst}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
