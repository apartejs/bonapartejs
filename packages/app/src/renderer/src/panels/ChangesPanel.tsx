/**
 * The « Changements » pane (board « Conversation au travail », task 6.4):
 * one card per file — first what waits for the person, « Proposé », then what
 * the conversation changed, « Appliqué » — its path, its counts, its diff
 * (aparté's view), folded or open on a click of its header. « Revenir » puts
 * an applied file back to before the conversation wrote it; a file changed
 * since is named, and left as it is. An applied file's lines can be
 * commented (board « Commenter le diff », task 6.5): the comments wait,
 * counted in the footer, and leave together in one message.
 */

import { changesRevert, toolsPreview, type AppliedChangeView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../aparte/approvals';
import { bridge } from '../bridge';
import type { AparteDiffCommentEventDetail } from '@aparte/plugin-diff';
import { summaryOf, whereOf, type ReviewComment } from '../diff/comments-store';
import { DiffView } from '../diff/DiffView';
import type { Messages } from '../i18n/index';

/** A card: a change applied, or one that waits. */
export interface ChangeCard {
  key: string;
  path: string;
  display: string;
  state: 'proposed' | 'applied';
  before: string | null;
  after: string | null;
  binary?: boolean;
}

export function appliedCards(applied: readonly AppliedChangeView[]): ChangeCard[] {
  return applied.map((change) => ({
    key: `applied:${change.path}`,
    path: change.path,
    display: change.display,
    state: 'applied',
    before: change.before,
    after: change.after,
    ...(change.binary ? { binary: true } : {}),
  }));
}

/** The changes waiting for the person, with what each would write (the core's preview). */
export function useProposedCards(conversationId: string | null, requests: readonly ApprovalRequest[]): ChangeCard[] {
  const [cards, setCards] = useState<ChangeCard[]>([]);
  const key = requests.map((request) => request.id).join(',');
  useEffect(() => {
    if (!conversationId || requests.length === 0) {
      setCards([]);
      return;
    }
    let current = true;
    void Promise.all(
      requests.map((request) =>
        bridge
          .invoke(toolsPreview, { id: conversationId, call: { name: request.name, input: request.input } })
          .then((preview): ChangeCard | null =>
            preview?.kind === 'diff'
              ? { key: `proposed:${request.id}`, path: preview.path, display: preview.path, state: 'proposed', before: preview.before, after: preview.after }
              : null,
          )
          .catch(() => null),
      ),
    ).then((found) => current && setCards(found.filter((card): card is ChangeCard => card !== null)));
    return () => {
      current = false;
    };
  }, [conversationId, key]);
  return cards;
}

export interface ChangesPanelProps {
  messages: Messages;
  conversationId: string | null;
  cards: readonly ChangeCard[];
  /** A file was put back: what shows it is read again. */
  onReverted(): void;
  /** The comments on the diff, kept by the app (aparté's view only shows them). */
  review: readonly ReviewComment[];
  onComment(detail: AparteDiffCommentEventDetail): void;
  onEdit(id: string, text: string): void;
  onClear(): void;
  onSend(): void;
}

/** The footer of a review: how many comments wait, each changeable, and what to do with them. */
function ReviewFooter({ messages, review, onEdit, onClear, onSend }: Pick<ChangesPanelProps, 'messages' | 'review' | 'onEdit' | 'onClear' | 'onSend'>) {
  const words = messages.review;
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const summary = summaryOf(review);
  if (summary.count === 0) return null;
  const ready = words.ready(summary.count, summary.files);
  return (
    <footer className="changes-pane__review">
      <ul className="changes-pane__comments">
        {review
          .filter((comment) => comment.state === 'pending')
          .map((comment) => (
            <li key={comment.id} className="changes-pane__comment">
              <code className="changes-pane__where">{whereOf(comment)}</code>
              {editing?.id === comment.id ? (
                <form
                  className="changes-pane__edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editing.text.trim()) onEdit(comment.id, editing.text.trim());
                    setEditing(null);
                  }}
                >
                  <textarea
                    className="aparte-field__input aparte-textarea"
                    rows={2}
                    aria-label={words.editLabel(whereOf(comment))}
                    value={editing.text}
                    onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
                  />
                  <span className="changes-pane__edit-actions">
                    <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => setEditing(null)}>
                      {words.cancel}
                    </button>
                    <button type="submit" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm">
                      {words.save}
                    </button>
                  </span>
                </form>
              ) : (
                <>
                  <span className="changes-pane__text">{comment.text}</span>
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--ghost aparte-btn--sm"
                    aria-label={words.editLabel(whereOf(comment))}
                    onClick={() => setEditing({ id: comment.id, text: comment.text })}
                  >
                    {words.edit}
                  </button>
                </>
              )}
            </li>
          ))}
      </ul>
      <div className="changes-pane__send">
        <span className="changes-pane__ready">
          <strong>{ready.strong}</strong>
          {ready.rest}
        </span>
        <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" onClick={onClear}>
          {words.clear}
        </button>
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm" onClick={onSend}>
          {words.send}
        </button>
      </div>
    </footer>
  );
}

export function ChangesPanel(props: ChangesPanelProps) {
  const { messages, conversationId, cards, onReverted, review, onComment } = props;
  const words = messages.changes;
  const [conflicts, setConflicts] = useState<Record<string, string>>({});

  const revert = (card: ChangeCard): void => {
    if (!conversationId) return;
    void bridge
      .invoke(changesRevert, { id: conversationId, path: card.path })
      .then((result) => {
        setConflicts((was) => {
          const next = { ...was };
          if (result.conflicts.length > 0) next[card.key] = words.conflict(card.display);
          else delete next[card.key];
          return next;
        });
        onReverted();
      })
      .catch(() => undefined);
  };

  if (cards.length === 0) return <p className="changes-pane__none">{words.none}</p>;
  const applied = cards.some((card) => card.state === 'applied');
  return (
    <div className="changes-pane">
      {applied ? <p className="changes-pane__hint">{messages.review.hint}</p> : null}
      {cards.map((card) => (
        // aparté's view gives each file its header: its path, its counts, its fold.
        <section key={card.key} aria-label={card.display} className="changes-pane__card">
          <div className="changes-pane__state">
            <span className={`aparte-badge aparte-badge--soft aparte-badge--${card.state === 'proposed' ? 'warning' : 'success'}`}>
              {card.state === 'proposed' ? words.proposed : words.applied}
            </span>
            {card.state === 'applied' ? (
              <button
                type="button"
                className="aparte-btn aparte-btn--outline aparte-btn--sm changes-pane__revert"
                aria-label={words.revertNamed(card.display)}
                onClick={() => revert(card)}
              >
                {words.revert}
              </button>
            ) : null}
          </div>
          {conflicts[card.key] ? (
            <p className="changes-pane__conflict" role="status">
              {conflicts[card.key]}
            </p>
          ) : null}
          {card.binary ? (
            <p className="changes-pane__note">{words.binary}</p>
          ) : (
            <DiffView
              path={card.display}
              before={card.before}
              after={card.after}
              {...(card.state === 'applied'
                ? { commentable: true, comments: review.filter((comment) => comment.path === card.display), onComment: (detail) => onComment(detail) }
                : {})}
            />
          )}
        </section>
      ))}
      <ReviewFooter messages={messages} review={review} onEdit={props.onEdit} onClear={props.onClear} onSend={props.onSend} />
    </div>
  );
}
