/**
 * What opening a conversation costs, said above the composer before it is
 * paid (canvas « Coûts annoncés », moments 1 and 2): its memory saved —
 * a quiet banner, nothing to choose — or let go — the re-read, with its time,
 * and nothing read before « Relire et continuer ».
 */

import type { ConversationMemoryView } from '@aparte/bonaparte-shared';
import { formatBytes, formatDuration, formatTokens, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';

type Announcement = NonNullable<ConversationMemoryView['announcement']>;

export interface MemoryBannerProps {
  announcement: Announcement;
  messages: Messages;
  style: NumberStyle;
  onContinue(): void;
}

export function MemoryBanner({ announcement, messages, style, onContinue }: MemoryBannerProps) {
  const text = messages.memory;
  const { locale } = style;
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
          {announcement.reason === 'evicted' && announcement.evicted
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
        </div>
      </div>
    </div>
  );
}
