/**
 * No engine can answer (review of phase 9): the built-in engine has no model yet, and the services known
 * offer none now — a service not started, say. A send is held, the draft kept, and the card says what to do:
 * prepare the built-in engine (the first launch's panel, over the conversations), or read the services again.
 * aparté's alert, as the other cards above the composer.
 */

import type { Messages } from '../i18n/index';

export interface NoEngineCardProps {
  messages: Messages;
  held: boolean;
  reading: boolean;
  onSetup(): void;
  onReadAgain(): void;
}

export function NoEngineCard({ messages, held, reading, onSetup, onReadAgain }: NoEngineCardProps) {
  const words = messages.noEngine;
  return (
    <div className="aparte-alert aparte-alert--warning no-engine-card" role="region" aria-label={words.title}>
      <div className="aparte-alert__body">
        <p className="aparte-alert__title">{words.title}</p>
        <p className="aparte-alert__message">{held ? words.held : words.body}</p>
        <div className="no-engine-card__actions">
          <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--primary aparte-btn--solid" onClick={onSetup}>
            {words.setup}
          </button>
          <button
            type="button"
            className="aparte-btn aparte-btn--sm aparte-btn--surface"
            disabled={reading}
            aria-busy={reading || undefined}
            onClick={onReadAgain}
          >
            {words.readAgain}
          </button>
        </div>
      </div>
    </div>
  );
}
