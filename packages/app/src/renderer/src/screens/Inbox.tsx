/**
 * « À traiter » (task 8.4, board « À traiter »): what waits for a decision of
 * the person, across the conversations, decided from here without opening
 * each one. An approval and a sub-agent's request are answered here: the
 * card resolves the same promise as the conversation's own (its chat is
 * mounted, hidden, while it waits). A question with choices is answered here
 * too (aparté 1.12, `observeElicitations`); any other opens its conversation,
 * where it waits in the composer. A pull request whose CI fails can be handed back to
 * the agent; a turn the engine cut is read again now, its cost said. At the
 * bottom, the replies finished since the person last looked.
 */

import type { InboxView } from '@aparte/bonaparte-shared';
import type { AparteElicitationPending } from '@aparte/core';
import { choicesOf, wordsOf } from '../aparte/questions';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApprovalAnswer, ApprovalRequest } from '../aparte/approvals';
import { ApprovalCard } from '../chat/ApprovalCard';
import { formatDuration, formatTokens } from '../format';
import type { Messages } from '../i18n/index';

export interface InboxPageProps {
  messages: Messages;
  locale: string;
  inbox: InboxView | null;
  /** The approvals waiting in the window's chats: answered from here. */
  requests: readonly ApprovalRequest[];
  /** A cost the person said « Plus tard » to, until something changes. */
  later: ReadonlySet<string>;
  /** The built-in engine is not loaded: an approval is answered in its conversation, which loads it first. */
  engineDown?: boolean;
  /** The question a conversation waits on, as its chat puts it on screen: answered from here when it is a choice. */
  questionOf?(conversationId: string): AparteElicitationPending | undefined;
  onAnswer(id: string, answer: ApprovalAnswer): void;
  onOpen(conversationId: string): void;
  onReadAgain(conversationId: string): Promise<void>;
  onLater(conversationId: string): void;
  onFix(conversationId: string, pr: number): void;
  onShowPr(conversationId: string): void;
}

/** « il y a 12 min », « hier »: when it began to wait. */
function ago(at: string, locale: string): string {
  const seconds = (Date.parse(at) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(Math.round(seconds), 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86_400), 'day');
}

function Card({
  kind,
  label,
  title,
  at,
  locale,
  open,
  extra,
  children,
}: {
  kind: 'approval' | 'subagent' | 'question' | 'ci' | 'cost';
  label: string;
  title: string;
  at: string;
  locale: string;
  open: ReactNode;
  extra?: string;
  children: ReactNode;
}) {
  return (
    <article className={`inbox-card inbox-card--${kind}`} aria-label={`${label} · ${title}`}>
      <p className="inbox-card__head">
        <span className="inbox-card__kind">{label}</span>
        <span className="inbox-card__where">{open}</span>
        {extra ? <span className="inbox-card__extra">{extra}</span> : null}
        <span className="inbox-card__spacer" />
        <time className="inbox-card__at" dateTime={at}>
          {ago(at, locale)}
        </time>
      </p>
      {children}
    </article>
  );
}

export function InboxPage(props: InboxPageProps) {
  const { messages, locale, inbox, requests } = props;
  const words = messages.inbox;
  const [reading, setReading] = useState<string | null>(null);
  // Opened, the page takes the keyboard: the button the person left behind keeps neither the focus nor its tooltip.
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => pageRef.current?.focus({ preventScroll: true }), []);
  const live = new Map(requests.map((request) => [request.id, request]));
  const link = (conversationId: string, title: string): ReactNode => (
    <button type="button" className="inbox-card__link" onClick={() => props.onOpen(conversationId)}>
      {title || words.untitled}
    </button>
  );
  const openButton = (conversationId: string): ReactNode => (
    <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => props.onOpen(conversationId)}>
      {words.open}
    </button>
  );
  if (!inbox) return <section ref={pageRef} tabIndex={-1} className="inbox-page" aria-label={words.title} />;
  const costs = inbox.costs.filter((cost) => !props.later.has(cost.conversationId));
  const nothing =
    inbox.approvals.length + inbox.subagentRequests.length + inbox.questions.length + inbox.ciFailures.length + costs.length === 0;

  return (
    <section ref={pageRef} tabIndex={-1} className="inbox-page" aria-label={words.title}>
      <header className="inbox-page__header">
        <h1 className="inbox-page__title">{words.title}</h1>
        <p className="inbox-page__lede">{words.lede}</p>
      </header>
      <div className="inbox-page__cards">
        {nothing ? <p className="inbox-page__none">{words.none}</p> : null}
        {[...inbox.approvals, ...inbox.subagentRequests].map((item) => {
          const request = live.get(item.call.id);
          const fromSubagent = 'agent' in item;
          return (
            <Card
              key={item.call.id}
              kind={fromSubagent ? 'subagent' : 'approval'}
              label={fromSubagent ? words.kinds.subagent : words.kinds.approval}
              title={item.title}
              at={item.at}
              locale={locale}
              open={link(item.conversationId, item.title)}
            >
              {/* The engine let go: an answer would resume the turn into nothing, and be lost (review of phase 8). */}
              {request && !props.engineDown ? (
                <ApprovalCard request={request} messages={messages} focus={false} onAnswer={(answer) => props.onAnswer(request.id, answer)}>
                  {openButton(item.conversationId)}
                </ApprovalCard>
              ) : (
                <div className="inbox-card__actions">
                  <p className="inbox-card__note">{props.engineDown ? words.engineDown : words.answerThere}</p>
                  {openButton(item.conversationId)}
                </div>
              )}
            </Card>
          );
        })}
        {inbox.questions.map((item) => {
          // A question with choices is answered here (aparté 1.12, apartejs/aparte#250); any other opens its
          // conversation, where it waits in the composer. The choices are those of the question its conversation
          // shows now, and only when its words are the card's: never a next question's choices under the one
          // answered. Not while the engine is unloaded: the answer would resume the turn into nothing, and be lost
          // (check of aparté 1.12).
          const live = props.questionOf?.(item.conversationId);
          const pending = live && wordsOf(live) === item.question && !props.engineDown ? live : undefined;
          const choices = pending ? choicesOf(pending) : null;
          return (
            <Card key={item.call.id} kind="question" label={words.kinds.question} title={item.title} at={item.at} locale={locale} open={link(item.conversationId, item.title)}>
              <p className="inbox-card__title">{item.question}</p>
              {props.engineDown ? <p className="inbox-card__note">{words.engineDown}</p> : null}
              <div className="inbox-card__actions">
                {pending && choices
                  ? choices.map((choice) => (
                      <button
                        key={choice.label}
                        type="button"
                        className="aparte-btn aparte-btn--outline aparte-btn--sm"
                        onClick={() => pending.respond({ action: 'accept', content: choice.value })}
                      >
                        {choice.label}
                      </button>
                    ))
                  : null}
                <button
                  type="button"
                  className={`aparte-btn aparte-btn--sm ${choices ? 'aparte-btn--ghost' : 'aparte-btn--primary aparte-btn--solid'}`}
                  onClick={() => props.onOpen(item.conversationId)}
                >
                  {choices ? words.open : words.answer}
                </button>
              </div>
            </Card>
          );
        })}
        {inbox.ciFailures.map((item) => (
          <Card
            key={`ci-${item.conversationId}`}
            kind="ci"
            label={words.kinds.ci}
            title={item.title}
            at={item.at}
            locale={locale}
            open={link(item.conversationId, item.title)}
            extra={words.pr(item.pr.number)}
          >
            <p className="inbox-card__title">{words.ciTitle(item.pr.number)}</p>
            <div className="inbox-card__actions">
              <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm" onClick={() => props.onFix(item.conversationId, item.pr.number)}>
                {words.fix}
              </button>
              <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" onClick={() => props.onShowPr(item.conversationId)}>
                {words.showPr}
              </button>
            </div>
          </Card>
        ))}
        {costs.map((item) => (
          <Card key={`cost-${item.conversationId}`} kind="cost" label={words.kinds.cost} title={item.title} at={item.at} locale={locale} open={link(item.conversationId, item.title)}>
            <p className="inbox-card__title">{words.costTitle(formatTokens(item.tokens, locale), formatDuration(item.seconds, locale))}</p>
            <div className="inbox-card__actions">
              <button
                type="button"
                className="aparte-btn aparte-btn--outline aparte-btn--sm"
                disabled={reading !== null}
                onClick={() => {
                  setReading(item.conversationId);
                  void props.onReadAgain(item.conversationId).finally(() => setReading(null));
                }}
              >
                {reading === item.conversationId ? words.reading : words.readAgain}
              </button>
              <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => props.onLater(item.conversationId)}>
                {words.later}
              </button>
            </div>
          </Card>
        ))}
      </div>
      {inbox.unread.length > 0 ? (
        <section className="inbox-page__unread" aria-label={words.unreadTitle}>
          <h2 className="inbox-page__subtitle">{words.unreadTitle}</h2>
          <ul className="inbox-page__rows">
            {inbox.unread.map((item) => (
              <li key={`unread-${item.conversationId}`}>
                <button type="button" className="inbox-row" onClick={() => props.onOpen(item.conversationId)}>
                  <span className="inbox-row__dot" role="img" aria-label={words.unreadDot} />
                  <span className="inbox-row__what">
                    <strong>{item.title || words.untitled}</strong>
                    <span className="inbox-row__said">{item.said}</span>
                  </span>
                  <time className="inbox-row__at" dateTime={item.at}>
                    {ago(item.at, locale)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
