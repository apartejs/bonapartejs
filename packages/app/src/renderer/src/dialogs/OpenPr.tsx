/**
 * « Ouvrir une PR » (task 6.8; audit 2026-11-21, D7): it goes online — the
 * branch pushed, a pull request opened — so what goes is said first: the
 * remote and its address, the branch, its commits, the files not committed
 * that stay (« Commiter d'abord »), and a title and a description the person
 * may change. Done on the person's word only; nothing is forced. What cannot
 * go, or could not, says why — with git's or GitHub's own line beside it.
 */

import type { PrPlanView, PrRefusalView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { Messages } from '../i18n/index';

/** At most this many commits listed; the rest counted. */
const LISTED = 8;

export interface OpenPrProps {
  messages: Messages;
  /** The branch asked about; null: closed. */
  asking: { branch: string; base: string } | null;
  /** What would go, as the core read it; null while it is read. */
  plan: PrPlanView | null;
  /** Why it did not open, the last time it was asked. */
  failure: { reason: PrRefusalView; detail: string } | null;
  busy: boolean;
  onCancel(): void;
  onOpen(text: { title: string; body: string }): void;
  onCommitFirst(): void;
}

export function OpenPr({ messages, asking, plan, failure, busy, onCancel, onOpen, onCommitFirst }: OpenPrProps) {
  const words = messages.pr;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);
  // The words proposed, once read: the person's own edits are kept while the dialog stays open.
  const proposed = plan ? `${plan.title}\u0000${plan.body}` : null;
  useEffect(() => {
    if (!plan) return;
    setTitle(plan.title);
    setBody(plan.body);
    // Only when what the core proposes changes (a commit made from here).
  }, [proposed]);
  const reason = failure?.reason ?? plan?.refused;
  const canGo = plan !== null && !plan.refused && title.trim() !== '' && !busy;
  return (
    <dialog ref={dialog} className="aparte-dialog open-pr" aria-labelledby={titleId} onClose={onCancel}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.openQuestion}
        </h2>
      </header>
      <div className="aparte-dialog__body open-pr__body">
        {asking && plan?.remote ? <p>{words.openWhat(asking.branch, plan.remote.name, plan.remote.url, asking.base)}</p> : null}
        {plan && plan.count > 0 ? (
          <div className="open-pr__commits">
            <p>{words.commits(plan.count)}</p>
            <ul className="open-pr__list">
              {plan.commits.slice(0, LISTED).map((commit) => (
                <li key={commit.hash}>
                  <code>{commit.hash}</code> {commit.subject}
                </li>
              ))}
              {plan.count > LISTED ? <li className="open-pr__more">{words.moreCommits(plan.count - LISTED)}</li> : null}
            </ul>
          </div>
        ) : null}
        {plan && plan.uncommitted > 0 ? (
          <div className="aparte-alert aparte-alert--warning open-pr__uncommitted">
            <p>{words.uncommittedStay(plan.uncommitted)}</p>
            <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" disabled={busy} onClick={onCommitFirst}>
              {words.commitFirst}
            </button>
          </div>
        ) : null}
        {plan && !plan.refused ? (
          <>
            <label className="aparte-field-label open-pr__field">
              {words.titleField}
              <input className="aparte-field" value={title} maxLength={256} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="aparte-field-label open-pr__field">
              {words.bodyField}
              <textarea className="aparte-field aparte-field--textarea" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
          </>
        ) : null}
        {reason ? (
          <div className="aparte-alert aparte-alert--danger open-pr__refused" role="alert">
            <p>{words.refused[reason]}</p>
            {failure?.detail ? (
              <p className="open-pr__said">
                {words.saidBy} <code>{failure.detail}</code>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" onClick={onCancel}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          aria-busy={busy}
          disabled={!canGo}
          onClick={() => onOpen({ title: title.trim(), body })}
        >
          {words.openConfirm}
        </button>
      </footer>
    </dialog>
  );
}
