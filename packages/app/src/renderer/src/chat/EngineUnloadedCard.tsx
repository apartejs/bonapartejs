/**
 * The engine unloaded (task 7.4; board « Coûts annoncés », 5): above the
 * composer, the model a load would bring back, what loading it costs — its
 * time, its video memory —, and when it was unloaded. « Charger et envoyer »
 * loads it, then sends what waits in the composer; « Un autre modèle… »
 * opens the composer's picker. Launching the app loads nothing.
 */

import type { EngineStateView } from '@aparte/bonaparte-shared';
import { formatBytes, formatDuration, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

export interface EngineUnloadedCardProps {
  messages: Messages;
  style: NumberStyle;
  resume: NonNullable<EngineStateView['resume']>;
  /** What loading it costs, once the core listed it. */
  cost: { seconds: number; vramBytes: number } | null;
  /** A message was sent meanwhile: it waits in the composer. */
  held: boolean;
  /** A load under way — this card's, or one started elsewhere (a restart, a change of model): no second one. */
  loading: boolean;
  failed: boolean;
  onLoad(): void;
  onOther(): void;
}

export function EngineUnloadedCard({ messages, style, resume, cost, held, loading, failed, onLoad, onOther }: EngineUnloadedCardProps) {
  const words = messages.engineUnloaded;
  const time = resume.unloadedAt
    ? new Intl.DateTimeFormat(style.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(resume.unloadedAt))
    : null;
  return (
    <div className="aparte-alert engine-unloaded" role="status">
      <Icon name="engine" />
      <div className="aparte-alert__body">
        <p className="aparte-alert__title">{loading ? words.titleLoading(resume.name) : words.title(resume.name)}</p>
        {cost ? (
          <p className="aparte-alert__message">{words.cost(formatDuration(cost.seconds, style.locale), formatBytes(cost.vramBytes, style))}</p>
        ) : null}
        {time ? (
          <p className="engine-unloaded__detail">
            {resume.idleMinutes !== undefined ? words.idle(time, resume.idleMinutes) : words.unloadedAt(time)}
          </p>
        ) : null}
        {held ? <p className="engine-unloaded__held">{words.held}</p> : null}
        {failed ? (
          <p className="engine-unloaded__failed" role="alert">
            {words.failed}
          </p>
        ) : null}
        {loading ? null : (
          <div className="engine-unloaded__actions">
            <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onLoad}>
              {words.load}
            </button>
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={onOther}>
              {words.other}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
