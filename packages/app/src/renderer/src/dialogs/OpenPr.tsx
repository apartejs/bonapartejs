/**
 * « Ouvrir une PR » (task 6.8): it goes online — the branch pushed to
 * GitHub, a pull request opened — so it is said first, and done on the
 * person's word only.
 */

import { useEffect, useId, useRef } from 'react';
import type { Messages } from '../i18n/index';

export interface OpenPrProps {
  messages: Messages;
  /** The branch asked about; null: closed. */
  asking: { branch: string; base: string; failed: boolean } | null;
  busy: boolean;
  onCancel(): void;
  onOpen(): void;
}

export function OpenPr({ messages, asking, busy, onCancel, onOpen }: OpenPrProps) {
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
    <dialog ref={dialog} className="aparte-dialog open-pr" aria-labelledby={titleId} onClose={onCancel}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.openQuestion}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        <p>{asking ? words.openWhat(asking.branch, asking.base) : ''}</p>
        {asking?.failed ? (
          <p className="aparte-alert aparte-alert--danger" role="alert">
            {words.openFailed}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" aria-busy={busy} disabled={busy} onClick={onOpen}>
          {words.openConfirm}
        </button>
      </footer>
    </dialog>
  );
}
