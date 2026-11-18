/**
 * The card of a call the core asks about (canvas « Conversation au travail »):
 * what it does and on what — « Modifier `src/format.ts` ? » —, what the mode
 * of the conversation means for it, and, for a write, what it would change:
 * aparté's own diff, from the texts the core computed (aparté's panel has no
 * place for it, apartejs/aparte#214). Nothing runs before « Autoriser »;
 * « Refuser… » takes a word for the model. Enter allows, Escape refuses.
 */

import '@aparte/plugin-diff';
import type { AparteDiff } from '@aparte/plugin-diff';
import { toolsPreview, type PlayMode, type ToolPreviewView } from '@aparte/bonaparte-shared';
import { createElement, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ApprovalAnswer, ApprovalRequest } from '../aparte/approvals';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

type Kind = keyof Messages['approval']['verbs'];

function kindOf(name: string): Kind {
  if (name === 'edit_file') return 'edit';
  if (name === 'write_file') return 'write';
  if (name === 'run_command' || name === 'browser_act') return 'run';
  if (name === 'web_fetch' || name === 'browser_open') return 'fetch';
  return 'other';
}

function targetOf(request: ApprovalRequest, preview: ToolPreviewView | null): string {
  const { input } = request;
  const text = (key: string): string | undefined => (typeof input[key] === 'string' ? (input[key] as string) : undefined);
  if (preview) return preview.path;
  if (request.name === 'run_command') {
    const args = Array.isArray(input['args']) ? input['args'].filter((arg): arg is string => typeof arg === 'string') : [];
    return [text('program') ?? '', ...args].join(' ').trim();
  }
  return text('path') ?? text('url') ?? request.name;
}

export interface ApprovalCardProps {
  request: ApprovalRequest;
  /** The conversation's mode, said on the card; absent on « À traiter », which does not know it. */
  mode?: PlayMode;
  messages: Messages;
  onAnswer(answer: ApprovalAnswer): void;
  /** « Autoriser et passer en Plume »: only where the conversation is open. */
  onAllowAndPlume?(): void;
  /** The card takes the focus on « Autoriser » (the composer's); not one card among others (« À traiter »). */
  focus?: boolean;
  /** More actions after its own (« Ouvrir la conversation »). */
  children?: ReactNode;
}

/**
 * May the card take the keyboard? When nothing has it, when the card itself has it, or from the composer the
 * person just sent from — empty, its field or its button. Never from someone writing elsewhere.
 */
function mayTakeFocus(button: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  const card = button?.closest('.approval-card');
  if (card?.contains(active)) return true;
  const composer = active.closest('aparte-composer');
  if (!composer) return false;
  const field = composer.querySelector('[contenteditable="true"], textarea');
  const text = field instanceof HTMLTextAreaElement ? field.value : (field?.textContent ?? '');
  return text.trim() === '';
}

export function ApprovalCard({ request, mode, messages, onAnswer, onAllowAndPlume, focus = true, children }: ApprovalCardProps) {
  const text = messages.approval;
  const kind = kindOf(request.name);
  const [preview, setPreview] = useState<ToolPreviewView | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const allow = useRef<HTMLButtonElement>(null);
  const diff = useRef<AparteDiff | null>(null);

  // What a write would change, as the core computes it — and the code of a plugin made here before it runs (task 11.4).
  useEffect(() => {
    setPreview(null);
    if ((kind !== 'edit' && kind !== 'write' && request.name !== 'extension_run') || !request.conversationId) return;
    let current = true;
    void bridge
      .invoke(toolsPreview, { id: request.conversationId, call: { name: request.name, input: request.input } })
      .then((view) => {
        if (current) setPreview(view);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [kind, request]);

  useEffect(() => {
    if (diff.current && preview?.kind === 'diff') diff.current.diff = { path: preview.path, before: preview.before, after: preview.after };
  }, [preview]);

  // The card takes the focus, on « Autoriser »: Enter allows, Escape refuses. Before it is painted: an Enter typed
  // as it appears must not reach the composer, where it would stop the reply. Only from someone who is not
  // writing elsewhere — a terminal, a comment, a draft: their Enter would approve a call they never saw (review
  // of phase 8).
  useLayoutEffect(() => {
    if (focus && mayTakeFocus(allow.current)) allow.current?.focus();
  }, [request, focus]);

  const refuse = (): void => onAnswer({ approved: false, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      refuse();
    } else if (
      event.key === 'Enter' &&
      !refusing &&
      // A focused button presses itself (« Refuser… » never allows); the field writes its line.
      !(event.target instanceof HTMLButtonElement) &&
      !(event.target instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      onAnswer({ approved: true });
    }
  };

  const fails =
    preview?.kind === 'fails'
      ? preview.reason === 'missing'
        ? text.fails.missing
        : preview.reason === 'not-found'
          ? text.fails.notFound
          : text.fails.ambiguous(preview.occurrences ?? 2)
      : null;

  return (
    <section className="approval-card" aria-label={text.region} onKeyDown={onKeyDown}>
      <div className="approval-card__head">
        <p className="approval-card__title">
          {text.verbs[kind]}
          <code>{targetOf(request, preview)}</code>
          {text.question}
        </p>
        {/* A sub-agent's call (task 8.2): who asks is named — never more than its conversation may. */}
        {request.agent?.name ? <span className="aparte-badge approval-card__asker">{text.askedBy(request.agent.name)}</span> : null}
        {mode ? <p className="approval-card__mode">{text.modeNote[mode]}</p> : null}
        {request.agent ? <p className="approval-card__only">{text.onlyIt}</p> : null}
      </div>
      {/* aparté's element, which JSX does not list: made as it is, given its texts through its property. */}
      {preview?.kind === 'diff' ? createElement('aparte-diff', { ref: diff, className: 'approval-card__diff' }) : null}
      {fails ? <p className="approval-card__fails">{fails}</p> : null}
      {refusing ? (
        <label className="approval-card__refusal">
          <span className="aparte-sr-only">{text.instructionLabel}</span>
          <textarea
            className="aparte-field aparte-field--textarea"
            placeholder={text.instructionPlaceholder}
            value={instruction}
            rows={2}
            autoFocus
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      ) : null}
      <div className="approval-card__actions">
        {refusing ? (
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={refuse}>
            {text.refuseConfirm}
          </button>
        ) : (
          <>
            <button ref={allow} type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => onAnswer({ approved: true })}>
              {text.allow}
            </button>
            {(kind === 'edit' || kind === 'write') && mode === 'repetition' && onAllowAndPlume ? (
              <button type="button" className="aparte-btn aparte-btn--outline" onClick={onAllowAndPlume}>
                {text.allowAndPlume}
              </button>
            ) : null}
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => setRefusing(true)}>
              {text.refuse}
            </button>
          </>
        )}
        {children}
        <span className="approval-card__hint">{text.hint}</span>
      </div>
    </section>
  );
}
