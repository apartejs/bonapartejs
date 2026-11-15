/**
 * « Passer à … ? » (task 7.4; board « Coûts annoncés », 3): a dialog, because
 * the engine restarts. What changing model costs is said before anything is
 * paid — the reload, the conversation read again for the new model, the
 * video memory after and now — and that the current memory stays saved for
 * the old one. « Annuler », « Brancher sur ce modèle » (a new conversation
 * goes on in it), « Changer » (this one does, at its next message).
 */

import type { EngineSwitchResult, ModelSwitchView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef } from 'react';
import { formatBytes, formatDuration, formatTokens, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';

export type ModelSwitchRefusal = Extract<EngineSwitchResult, { ok: false }>['error']['code'];

export interface ModelSwitchAsking {
  /** The model asked for, by its name, while its cost is read. */
  name: string;
  /** Its cost, once the core said it. */
  view: ModelSwitchView | null;
  /** The conversation shown has messages: it can go on elsewhere (« Brancher sur ce modèle »). */
  hasHistory: boolean;
}

export interface ModelSwitchDialogProps {
  messages: Messages;
  style: NumberStyle;
  asking: ModelSwitchAsking | null;
  busy: boolean;
  refused: ModelSwitchRefusal | null;
  onCancel(): void;
  onSwitch(as: 'here' | 'copy'): void;
}

export function ModelSwitchDialog({ messages, style, asking, busy, refused, onCancel, onSwitch }: ModelSwitchDialogProps) {
  const words = messages.modelSwitch;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);

  const view = asking?.view ?? null;
  const cost = view?.announcement;
  const duration = (seconds: number) => words.about(formatDuration(seconds, style.locale));
  return (
    <dialog
      ref={dialog}
      className="aparte-dialog model-switch-dialog"
      aria-labelledby={titleId}
      // Escape while the model loads would leave it loading unseen: the dialog stays until it is done.
      onCancel={(event) => busy && event.preventDefault()}
      onClose={onCancel}
    >
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {asking ? words.title(asking.name) : ''}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        {cost ? (
          <dl className="model-switch-dialog__costs">
            <dt>{words.reload}</dt>
            <dd>{duration(cost.reloadSeconds)}</dd>
            {cost.rereadTokens > 0 ? (
              <>
                <dt>{words.reread(formatTokens(cost.rereadTokens, style.locale))}</dt>
                <dd>{duration(cost.rereadSeconds)}</dd>
              </>
            ) : null}
            <dt>{words.vram}</dt>
            <dd>{words.vramAfter(formatBytes(cost.vramBytes, style), cost.vramBytesNow > 0 ? formatBytes(cost.vramBytesNow, style) : null)}</dd>
          </dl>
        ) : (
          <p className="aparte-field-hint">{words.reading}</p>
        )}
        {view?.from && asking?.hasHistory ? <p className="model-switch-dialog__note">{words.kept(view.from.name)}</p> : null}
        {cost?.estimated ? <p className="aparte-field-hint">{words.estimated}</p> : null}
        {busy ? <p className="aparte-field-hint" role="status">{words.loading}</p> : null}
        {refused ? (
          <p className="model-switch-dialog__refused" role="alert">
            {words.refused[refused]}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--outline" disabled={busy} onClick={onCancel}>
          {words.cancel}
        </button>
        {asking?.hasHistory ? (
          <button type="button" className="aparte-btn aparte-btn--outline" disabled={!cost || busy} onClick={() => onSwitch('copy')}>
            {words.branch}
          </button>
        ) : null}
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={!cost || busy}
          aria-busy={busy || undefined}
          onClick={() => onSwitch('here')}
        >
          {words.change}
        </button>
      </footer>
    </dialog>
  );
}
