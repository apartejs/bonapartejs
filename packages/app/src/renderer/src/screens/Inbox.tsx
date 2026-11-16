/**
 * « À traiter » (task 8.4, board « À traiter »): what waits for a decision of
 * the person, across the conversations, decided from here without opening
 * each one. An approval and a sub-agent's request are answered here: the
 * card resolves the same promise as the conversation's own (its chat is
 * mounted, hidden, while it waits). A question opens its conversation, where
 * it waits in the composer — aparté offers no way to answer it from outside
 * (apartejs/aparte#250). A pull request whose CI fails can be handed back to
 * the agent; a turn the engine cut is read again now, its cost said. At the
 * bottom, the replies finished since the person last looked.
 */

import type { InboxView } from '@aparte/bonaparte-shared';
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
              {request ? (
                <ApprovalCard request={request} messages={messages} focus={false} onAnswer={(answer) => props.onAnswer(request.id, answer)}>
                  {openButton(item.conversationId)}
                </ApprovalCard>
              ) : (
                <div className="inbox-card__actions">
                  <p className="inbox-card__note">{words.answerThere}</p>
                  {openButton(item.conversationId)}
                </div>
              )}
            </Card>
          );
        })}
        {inbox.questions.map((item) => (
          <Card key={item.call.id} kind="question" label={words.kinds.question} title={item.title} at={item.at} locale={locale} open={link(item.conversationId, item.title)}>
            <p className="inbox-card__title">{item.question}</p>
            <div className="inbox-card__actions">
              <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm" onClick={() => props.onOpen(item.conversationId)}>
                {words.answer}
              </button>
            </div>
          </Card>
        ))}
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
