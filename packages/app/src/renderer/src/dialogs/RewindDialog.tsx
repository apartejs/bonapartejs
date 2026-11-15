/**
 * « Revenir avant » a message (board « Revenir en arrière », task 7.2): what
 * would move is said before anything moves — the files, the memory, the
 * commands that already ran — with three choices, « Le code et la
 * conversation » by default.
 */

import type { RewindWhatView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDuration, formatTokens } from '../format';
import type { Messages } from '../i18n/index';

/** What going back would move, as the core read it. */
export interface RewindPreviewView {
  files: string[];
  commands: string[];
  memory: 'kept' | { kind: 'reread'; tokens: number; seconds: number } | null;
}

export interface RewindDialogProps {
  messages: Messages;
  locale: string;
  /** The message to go back before (its words), and what it would move once read; null: closed. */
  asking: { excerpt: string; preview: RewindPreviewView | null } | null;
  busy: boolean;
  onCancel(): void;
  onRewind(what: RewindWhatView): void;
}

const CHOICES: readonly RewindWhatView[] = ['both', 'conversation', 'code'];

export function RewindDialog({ messages, locale, asking, busy, onCancel, onRewind }: RewindDialogProps) {
  const words = messages.rewind;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [what, setWhat] = useState<RewindWhatView>('both');
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) {
      setWhat('both');
      element.showModal();
    }
    if (!asking && element.open) element.close();
  }, [asking]);

  const preview = asking?.preview ?? null;
  const label = { both: words.both, conversation: words.conversation, code: words.code } as const;
  const hint = { both: words.bothHint, conversation: words.conversationHint, code: words.codeHint } as const;
  const lines: string[] = [];
  if (preview) {
    lines.push(what === 'conversation' ? words.filesStay(preview.files) : words.filesBack(preview.files));
    if (what === 'code') lines.push(words.memoryStill);
    else if (preview.memory === 'kept') lines.push(words.memoryKept);
    else if (preview.memory) lines.push(words.memoryReread(formatTokens(preview.memory.tokens, locale), formatDuration(preview.memory.seconds, locale)));
    if (what !== 'code') lines.push(words.kept);
  }
  return (
    <dialog ref={dialog} className="aparte-dialog rewind-dialog" aria-labelledby={titleId} onClose={onCancel}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {asking ? words.title(asking.excerpt) : ''}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        <fieldset className="aparte-fieldset rewind-dialog__choices" role="radiogroup" aria-label={words.whatGroup}>
          {CHOICES.map((one) => (
            <label key={one} className={`aparte-field-choice aparte-field-choice--boxed${what === one ? ' aparte-field-choice--selected' : ''}`}>
              <input type="radio" className="aparte-radio" name="rewind-what" checked={what === one} onChange={() => setWhat(one)} />
              <span className="aparte-field-choice__body">
                <strong>{label[one]}</strong>
                <span className="aparte-field-hint">{hint[one]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {preview ? (
          <ul className="rewind-dialog__lines">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {preview.commands.length > 0 ? (
              <li className="rewind-dialog__warning">{words.commands(preview.commands.join(', '), preview.commands.length)}</li>
            ) : null}
          </ul>
        ) : (
          <p className="aparte-field-hint">{words.reading}</p>
        )}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--outline" onClick={onCancel}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={!preview || busy}
          aria-busy={busy || undefined}
          onClick={() => onRewind(what)}
        >
          {words.confirm}
        </button>
      </footer>
    </dialog>
  );
}
