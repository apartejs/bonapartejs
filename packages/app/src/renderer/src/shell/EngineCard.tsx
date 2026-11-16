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
  // A sub-agent works in the engine (task 8.2): its conversation waits on disk, and the card says who works.
  const subagent = engine.working?.subagent;
  return (
    <div className="aparte-card engine-card" data-working={subagent ? 'subagent' : undefined}>
      <div className="engine-card__name">
        <span className="engine-card__dot" role="img" aria-label={subagent ? messages.engineCard.busy : messages.engineCard.ready} />
        <span className="engine-card__model">{engine.model.name}</span>
      </div>
      <p className="engine-card__line">
        {subagent ? messages.engineCard.working(subagent) : messages.engineCard.line(contextSize(engine.model.nCtx))}
      </p>
    </div>
  );
}
