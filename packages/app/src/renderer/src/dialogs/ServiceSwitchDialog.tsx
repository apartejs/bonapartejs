/**
 * « Passer à … (service) ? » (task 9.3): a conversation of the built-in engine goes to a service between two
 * turns. What it loses is said first — its memory (the service receives it whole at every turn), costs announced
 * precisely — and what stays: its memory, saved for the built-in model. « Annuler », « Changer ».
 */

import { useEffect, useId, useRef } from 'react';
import type { Messages } from '../i18n/index';

export interface ServiceSwitchAsking {
  model: string;
  service: string;
  /** The built-in model the conversation's memory stays saved for. */
  keptFor: string | null;
}

export interface ServiceSwitchDialogProps {
  messages: Messages;
  asking: ServiceSwitchAsking | null;
  busy: boolean;
  failed: boolean;
  onCancel(): void;
  onSwitch(): void;
}

export function ServiceSwitchDialog({ messages, asking, busy, failed, onCancel, onSwitch }: ServiceSwitchDialogProps) {
  const words = messages.modelSwitch;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);
  return (
    <dialog
      ref={dialog}
      className="aparte-dialog model-switch-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => busy && event.preventDefault()}
      onClose={onCancel}
    >
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {asking ? words.toService.title(asking.model, asking.service) : ''}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        <p>{words.toService.lost}</p>
        <p className="aparte-field-hint">{words.toService.costs}</p>
        {asking?.keptFor ? <p className="model-switch-dialog__note">{words.toService.kept(asking.keptFor)}</p> : null}
        {failed ? (
          <p className="model-switch-dialog__refused" role="alert">
            {words.toService.failed}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--outline" disabled={busy} onClick={onCancel}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onSwitch}
        >
          {words.change}
        </button>
      </footer>
    </dialog>
  );
}
