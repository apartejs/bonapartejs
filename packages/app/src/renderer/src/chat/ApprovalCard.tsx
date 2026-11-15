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
import { createElement, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  mode: PlayMode;
  messages: Messages;
  onAnswer(answer: ApprovalAnswer): void;
  onAllowAndPlume(): void;
}

export function ApprovalCard({ request, mode, messages, onAnswer, onAllowAndPlume }: ApprovalCardProps) {
  const text = messages.approval;
  const kind = kindOf(request.name);
  const [preview, setPreview] = useState<ToolPreviewView | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const allow = useRef<HTMLButtonElement>(null);
  const diff = useRef<AparteDiff | null>(null);

  // What a write would change, as the core computes it.
  useEffect(() => {
    setPreview(null);
    if ((kind !== 'edit' && kind !== 'write') || !request.conversationId) return;
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

  // The card takes the focus, on « Autoriser »: Enter allows, Escape refuses.
  useEffect(() => allow.current?.focus(), [request]);

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
        <p className="approval-card__mode">{text.modeNote[mode]}</p>
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
            {(kind === 'edit' || kind === 'write') && mode === 'repetition' ? (
              <button type="button" className="aparte-btn aparte-btn--outline" onClick={onAllowAndPlume}>
                {text.allowAndPlume}
              </button>
            ) : null}
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => setRefusing(true)}>
              {text.refuse}
            </button>
          </>
        )}
        <span className="approval-card__hint">{text.hint}</span>
      </div>
    </section>
  );
}
