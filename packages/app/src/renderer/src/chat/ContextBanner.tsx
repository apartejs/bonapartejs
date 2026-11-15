/**
 * The context nearly full (board « Coûts annoncés », 4; task 7.3): said
 * before an answer is cut, not after — how full, the bar, what compacting
 * does and takes, « Compacter » or « Continuer quand même ». The same place
 * says a compaction under way, and why one did not happen.
 */

import type { ContextFullView } from '@aparte/bonaparte-shared';
import { formatDuration, formatTokens } from '../format';
import type { Messages } from '../i18n/index';

export type CompactionState = { kind: 'running' } | { kind: 'refused'; reason: keyof Messages['compact']['refused'] };

export interface ContextBannerProps {
  context: ContextFullView | null;
  state: CompactionState | null;
  messages: Messages;
  locale: string;
  onCompact(): void;
  onLater(): void;
}

export function ContextBanner({ context, state, messages, locale, onCompact, onLater }: ContextBannerProps) {
  const words = messages.compact;
  if (state) {
    return (
      <div className={`aparte-alert ${state.kind === 'running' ? 'aparte-alert--info' : 'aparte-alert--warning'} context-banner`} role="status">
        <div className="aparte-alert__body">
          <p className="aparte-alert__message">{state.kind === 'running' ? words.running : words.refused[state.reason]}</p>
        </div>
        {state.kind === 'refused' ? (
          <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" onClick={onLater}>
            {words.later}
          </button>
        ) : null}
      </div>
    );
  }
  if (!context) return null;
  const percent = Math.min(100, Math.round((context.used / context.window) * 100));
  return (
    <div className="aparte-alert aparte-alert--warning context-banner" role="status">
      <div className="aparte-alert__body">
        <p className="aparte-alert__title context-banner__head">
          <span>{words.full(percent)}</span>
          <span className="context-banner__counts">{words.counts(formatTokens(context.used, locale), formatTokens(context.window, locale))}</span>
        </p>
        <div className="context-banner__bar" role="img" aria-label={words.bar(percent)}>
          <span className="context-banner__fill" style={{ inlineSize: `${percent}%` }} />
        </div>
        <p className="aparte-alert__message">{words.line}</p>
        <div className="context-banner__actions">
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onCompact}>
            {words.now(formatDuration(context.compactSeconds, locale))}
          </button>
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={onLater}>
            {words.later}
          </button>
        </div>
      </div>
    </div>
  );
}
