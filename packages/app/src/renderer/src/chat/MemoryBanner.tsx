/**
 * What opening a conversation costs, said above the composer before it is
 * paid (canvas « Coûts annoncés », moments 1 and 2): its memory saved —
 * a quiet banner, nothing to choose — or let go — the re-read, with its time,
 * and nothing read before « Relire et continuer ».
 */

import type { ConversationMemoryView } from '@aparte/bonaparte-shared';
import { formatBytes, formatDuration, formatTokens, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';
import { FailureCard } from '../failures/FailureCard';

type Announcement = NonNullable<ConversationMemoryView['announcement']>;

export interface MemoryBannerProps {
  announcement: Announcement;
  messages: Messages;
  style: NumberStyle;
  onContinue(): void;
  /** « Compacter d'abord » (task 7.3): the conversation summarised before it is read again. */
  onCompactFirst?(): void;
  /**
   * Its memory made with another model (task 12.3, board « Quand quelque chose casse »): that model, if it is still
   * on the machine, with what loading it costs, and the model the engine runs.
   */
  otherModel?: { saved: { path: string; name: string; seconds: number } | null; savedName: string; running: string };
  onBack?(path: string, name: string): void;
}

export function MemoryBanner({ announcement, messages, style, onContinue, onCompactFirst, otherModel, onBack }: MemoryBannerProps) {
  const text = messages.memory;
  const { locale } = style;
  if (announcement.kind === 'reread' && announcement.reason === 'other-model' && otherModel) {
    const words = messages.failures.otherModel;
    const back = otherModel.saved;
    return (
      <FailureCard
        tone="neutral"
        className="memory-banner"
        context={words.context}
        title={words.title}
        headline={words.headline(otherModel.savedName, otherModel.running)}
        detail={words.detail}
        actions={[
          ...(back && onBack ? [{ label: words.back(back.name, formatDuration(back.seconds, locale)), run: () => onBack(back.path, back.name) }] : []),
          { label: words.reread(formatDuration(announcement.seconds, locale)), run: onContinue, weight: back ? ('secondary' as const) : ('primary' as const) },
        ]}
      />
    );
  }
  const estimated = announcement.estimated ? ` ${text.estimated}` : '';
  if (announcement.kind === 'restore') {
    const saved = new Date(announcement.savedAt);
    const date = saved.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
    const time = saved.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="aparte-alert aparte-alert--success memory-banner" role="status">
        <div className="aparte-alert__body">
          <p className="aparte-alert__title">{text.restoreTitle(formatTokens(announcement.tokens, locale))}</p>
          <p className="aparte-alert__message">
            {text.restoreLine(formatDuration(announcement.seconds, locale), formatDuration(announcement.insteadOfSeconds, locale)) +
              estimated}
          </p>
          <p className="memory-banner__detail">{text.restoreSaved(date, time, formatBytes(announcement.bytes, style))}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="aparte-alert aparte-alert--warning memory-banner" role="status">
      <div className="aparte-alert__body">
        <p className="aparte-alert__title">
          {text.rereadTitle(formatTokens(announcement.tokens, locale), formatDuration(announcement.seconds, locale)) + estimated}
        </p>
        <p className="aparte-alert__message">
          {announcement.reason === 'evicted' && announcement.evicted?.byPerson
            ? text.rereadReleased(new Date(announcement.evicted.at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }))
            : announcement.reason === 'evicted' && announcement.evicted
            ? text.rereadEvicted(
                new Date(announcement.evicted.at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
                formatBytes(announcement.evicted.budgetBytes, style),
              )
            : text.rereadReason[announcement.reason]}
        </p>
        <div className="memory-banner__actions">
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onContinue}>
            {text.rereadContinue}
          </button>
          {onCompactFirst && announcement.compactSeconds !== undefined ? (
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={onCompactFirst}>
              {messages.compact.first(formatDuration(announcement.compactSeconds, locale))}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
