/**
 * Choosing the model the built-in engine runs, and loading it. Provisional:
 * the first-run screen replaces it (plan, task 9.6). Nothing is launched
 * before « Démarrer », and what loading costs — its time, its video memory —
 * is said before the click, as the core computed it.
 *
 * Everything comes from aparté's kit: a card, boxed radio choices, badges, an
 * alert, a spinner, a button. The page only lays them out.
 */

import {
  engineLoad,
  engineModels,
  type EngineLoadResult,
  type EngineStateView,
  type Locale,
  type ModelChoiceView,
} from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { formatBytes, formatSeconds, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';

type Failure = Extract<EngineLoadResult, { ok: false }>['error'];
type Verdict = NonNullable<ModelChoiceView['announcement']>['verdict'];

const TONE: Record<Verdict, string> = {
  fits: 'aparte-badge--success',
  tight: 'aparte-badge--warning',
  'too-big': 'aparte-badge--danger',
  unknown: 'aparte-badge--neutral',
};

/** A model the engine can be asked to load: a family it speaks, a header it read. */
function loadable(model: ModelChoiceView): boolean {
  return model.supported && model.announcement !== null;
}

/** The models the engine can load first, in the core's order; the others after, with their reason. */
function inOrder(models: readonly ModelChoiceView[]): ModelChoiceView[] {
  return [...models.filter(loadable), ...models.filter((model) => !loadable(model))];
}

/** The model chosen at first: the first that fits, else the first that loads at all. */
function firstChoice(models: readonly ModelChoiceView[]): string | null {
  const candidates = models.filter(loadable);
  const fitting = candidates.find((model) => model.announcement?.verdict !== 'too-big');
  return (fitting ?? candidates[0])?.path ?? null;
}

export interface EngineSetupProps {
  messages: Messages;
  locale: Locale;
  /** The engine is ready: the conversation can begin. */
  onReady(state: EngineStateView): void;
}

export function EngineSetup({ messages, locale, onReady }: EngineSetupProps) {
  const text = messages.engineSetup;
  const style: NumberStyle = { locale, units: messages.units };
  const [models, setModels] = useState<ModelChoiceView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    let current = true;
    void bridge.invoke(engineModels, undefined).then((found) => {
      if (!current) return;
      setModels(inOrder(found));
      setSelected(firstChoice(found));
    });
    return () => {
      current = false;
    };
  }, []);

  const chosen = models?.find((model) => model.path === selected) ?? null;
  const cost = chosen?.announcement ?? null;

  async function start(): Promise<void> {
    if (!chosen) return;
    setLoading(true);
    setFailure(null);
    try {
      const result = await bridge.invoke(engineLoad, { path: chosen.path });
      if (result.ok) {
        onReady(result.state);
        return;
      }
      setFailure(result.error);
    } catch (error) {
      setFailure({ code: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
    setLoading(false);
  }

  function details(model: ModelChoiceView): string {
    const parts = [
      model.family ? messages.families[model.family] : null,
      formatBytes(model.sizeBytes, style),
      model.kvBytesPerToken ? text.perToken(formatBytes(model.kvBytesPerToken, style)) : null,
    ];
    return parts.filter((part): part is string => part !== null).join(' · ');
  }

  return (
    <section className="engine-setup" aria-labelledby="engine-setup-title">
      <div className="aparte-card engine-setup__card">
        <header className="aparte-card__header engine-setup__header">
          <h1 id="engine-setup-title" className="engine-setup__title">
            {text.title}
          </h1>
          <p className="engine-setup__lede">{text.lede}</p>
        </header>

        <div className="aparte-card__body engine-setup__body">
          {models === null ? (
            <p className="engine-setup__searching" role="status">
              <span className="aparte-spinner aparte-spinner--sm" aria-hidden="true" />
              {text.searching}
            </p>
          ) : models.length === 0 ? (
            <div className="engine-setup__empty">
              <p className="engine-setup__empty-title">{text.empty.title}</p>
              <p className="aparte-field-hint">{text.empty.body}</p>
            </div>
          ) : (
            <fieldset className="aparte-fieldset" disabled={loading}>
              <legend>{text.modelsLegend}</legend>
              {models.map((model) => (
                <label key={model.path} className="aparte-field-choice aparte-field-choice--boxed model-row">
                  <input
                    type="radio"
                    name="engine-model"
                    className="aparte-radio"
                    checked={model.path === selected}
                    disabled={!loadable(model)}
                    onChange={() => setSelected(model.path)}
                  />
                  <span className="aparte-field-choice__body">
                    <span className="model-row__name">{model.name}</span>
                    <span className="aparte-field-hint">{details(model)}</span>
                    {model.problem ? <span className="aparte-field-warning">{text.problem[model.problem]}</span> : null}
                  </span>
                  {loadable(model) && model.announcement ? (
                    <span className={`aparte-badge ${TONE[model.announcement.verdict]} model-row__verdict`}>
                      {text.verdict[model.announcement.verdict]}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          )}

          {failure ? (
            <div className="aparte-alert aparte-alert--danger engine-setup__failure" role="alert">
              <div className="aparte-alert__body">
                <p className="aparte-alert__title">{text.failed.title}</p>
                <p className="aparte-alert__message">{text.failed.reason[failure.code]}</p>
                {failure.code === 'failed' && failure.detail ? (
                  <pre className="engine-setup__log">{failure.detail}</pre>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="aparte-card__footer engine-setup__footer" hidden={models?.length === 0}>
          <p className="engine-announcement">
            {cost
              ? text.announce({
                  seconds: formatSeconds(cost.seconds),
                  estimated: cost.secondsEstimated,
                  vram: formatBytes(cost.vramBytes, style),
                  gpu: cost.gpuBytes === null ? null : formatBytes(cost.gpuBytes, style),
                })
              : null}
          </p>
          <button
            type="button"
            className="aparte-btn aparte-btn--primary aparte-btn--solid"
            disabled={!chosen || !loadable(chosen) || loading}
            aria-busy={loading}
            onClick={() => void start()}
          >
            {/* The kit's aria-busy only changes the cursor: the spinner is placed by hand (apartejs/aparte#206). */}
            {loading ? <span className="aparte-spinner aparte-spinner--sm" aria-hidden="true" /> : null}
            {loading ? text.starting : text.start}
          </button>
        </footer>
      </div>
    </section>
  );
}
