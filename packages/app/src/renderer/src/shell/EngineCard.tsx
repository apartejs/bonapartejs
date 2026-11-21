/**
 * The engine at the foot of the sidebar (canvas « Conversation au travail »):
 * its model, and that it is ready with its context. Provisional: the full
 * card — video memory, the link to « Moteur et mémoire » — comes with the
 * shell (5.6) and its settings page (5.7).
 */

import type { EngineStateView, ResourceSampleView } from '@aparte/bonaparte-shared';
import { formatBytes } from '../format';
import type { Messages } from '../i18n/index';

/** « 8 k », « 32 k »: a context in thousands, as the canvas writes it. */
function contextSize(tokens: number): string {
  return `${Math.round(tokens / 1024)} k`;
}

/** One figure: its name, its value in words, and a bar of the kit when there is a share to draw. */
function Meter({ name, value, share }: { name: string; value: string; share: number | null }) {
  return (
    <div className="engine-card__meter">
      <span className="engine-card__meter-text">
        {name} {value}
      </span>
      {share !== null ? (
        <div className="aparte-progress engine-card__bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
          <div className="aparte-progress__bar" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** « Moniteur de ressources » (task 12.4): the processor, the memory and the graphics card — a figure not known is said so. */
function Resources({ sample, messages, locale }: { sample: ResourceSampleView; messages: Messages; locale: string }) {
  const words = messages.engineCard.resources;
  const style = { locale, units: messages.units };
  const memoryShare = sample.memory.totalBytes > 0 ? (sample.memory.usedBytes / sample.memory.totalBytes) * 100 : null;
  return (
    <div className="engine-card__resources" role="group" aria-label={words.label}>
      <Meter name={words.cpu} value={sample.cpu === null ? words.unknown : words.percent(Math.round(sample.cpu))} share={sample.cpu} />
      <Meter
        name={words.memory}
        value={sample.memory.totalBytes > 0 ? words.of(formatBytes(sample.memory.usedBytes, style), formatBytes(sample.memory.totalBytes, style)) : words.unknown}
        share={memoryShare}
      />
      <Meter
        name={words.gpu}
        value={sample.gpu?.utilization === null || sample.gpu?.utilization === undefined ? words.unknown : words.percent(Math.round(sample.gpu.utilization))}
        share={sample.gpu?.utilization ?? null}
      />
    </div>
  );
}

export function EngineCard({ engine, messages, resources, locale }: { engine: EngineStateView; messages: Messages; resources?: ResourceSampleView | null; locale?: string }) {
  if (!engine.model) return null;
  // A conversation or one of its sub-agents works in the engine (task 8.2, audit C1): the card says who.
  const working = engine.working;
  const words = messages.engineCard;
  const who = working
    ? working.subagent
      ? words.subagent(working.subagent)
      : words.conversation(working.title.trim() || messages.engineWait.untitled)
    : null;
  return (
    <div className="aparte-card engine-card" data-working={working ? (working.subagent ? 'subagent' : 'conversation') : undefined}>
      <div className="engine-card__name">
        <span className="engine-card__dot" role="img" aria-label={working ? words.busy : words.ready} />
        <span className="engine-card__model">{engine.model.name}</span>
      </div>
      <p className="engine-card__line">
        {working && who ? words.working(who, working.others) : words.line(contextSize(engine.model.nCtx), engine.model.slots ?? 1)}
      </p>
      {resources ? <Resources sample={resources} messages={messages} locale={locale ?? 'fr'} /> : null}
    </div>
  );
}
