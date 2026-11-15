/**
 * The engine at the foot of the sidebar (canvas « Conversation au travail »):
 * its model, and that it is ready with its context. Provisional: the full
 * card — video memory, the link to « Moteur et mémoire » — comes with the
 * shell (5.6) and its settings page (5.7).
 */

import type { EngineStateView } from '@aparte/bonaparte-shared';
import type { Messages } from '../i18n/index';

/** « 8 k », « 32 k »: a context in thousands, as the canvas writes it. */
function contextSize(tokens: number): string {
  return `${Math.round(tokens / 1024)} k`;
}

export function EngineCard({ engine, messages }: { engine: EngineStateView; messages: Messages }) {
  if (!engine.model) return null;
  return (
    <div className="aparte-card engine-card">
      <div className="engine-card__name">
        <span className="engine-card__dot" role="img" aria-label={messages.engineCard.ready} />
        <span className="engine-card__model">{engine.model.name}</span>
      </div>
      <p className="engine-card__line">{messages.engineCard.line(contextSize(engine.model.nCtx))}</p>
    </div>
  );
}
