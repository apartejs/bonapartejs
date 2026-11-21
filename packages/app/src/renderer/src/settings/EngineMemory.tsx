/**
 * « Moteur et mémoire » (board): the engine — since when, its model, its
 * llama.cpp, its context —, « Décharger », « Redémarrer » announced before,
 * « Changer de modèle… »; the memory of the conversations — the disk budget
 * (lowered under the usage, it says which memories go before it does), a
 * table of what each conversation keeps and « Libérer » —; the shared prefix.
 */

import {
  engineLlama,
  engineMemory,
  engineModels,
  engineReleaseMemory,
  engineRestart,
  engineUnload,
  type MemoryOverviewView,
} from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import { formatBytes, formatDuration, formatTokens, type NumberStyle } from '../format';
import { memoriesToFree } from './budget';
import { LaunchSettings } from './LaunchSettings';
import type { PageProps } from './SettingsView';

const GIB = 1024 ** 3;

/** Said on the window when the settings close: the window reads the engine's state again (unloaded, restarted). */
export const ENGINE_CHANGED = 'bonaparte-engine';
/** Asks the window for the first launch's panel again, over the conversations (review of phase 9). */
export const SETUP_ENGINE = 'bonaparte-setup-engine';

export function EngineMemoryPage({ messages, locale, values, change, onPage }: PageProps & { onPage(page: 'models'): void }) {
  const words = messages.settings.engine;
  const style: NumberStyle = { locale, units: messages.units };
  const [overview, setOverview] = useState<MemoryOverviewView | null>(null);
  const [build, setBuild] = useState<string | null>(null);
  const [restartSeconds, setRestartSeconds] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const questionId = useId();

  const read = (): void => {
    void bridge.invoke(engineMemory, undefined).then(setOverview).catch(() => undefined);
  };
  useEffect(() => {
    read();
    void bridge
      .invoke(engineLlama, {})
      .then((llama) => setBuild(llama.current?.build ?? null))
      .catch(() => undefined);
    // The engine changed while the page is open (a restart that ends, an unload for want of work): read again.
    return bridge.on((event) => {
      if (event.kind === 'engine') read();
    });
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);

  if (!overview) return null;
  const { engine } = overview;
  const since = engine.since ? (Date.now() - Date.parse(engine.since)) / 1000 : null;
  const budgetGiB = Number.parseFloat(draft.replace(',', '.'));
  const newBudget = Number.isFinite(budgetGiB) && budgetGiB > 0 ? Math.round(budgetGiB * GIB) : null;
  // What the retention would let go under the new budget, by conversation.
  const freed = newBudget === null ? [] : memoriesToFree(overview.rows, overview.usedBytes, newBudget);
  const applyBudget = async (): Promise<void> => {
    if (newBudget === null) return;
    for (const row of freed) await bridge.invoke(engineReleaseMemory, { id: row.id }).catch(() => undefined);
    change('kvBudgetBytes', newBudget);
    setEditing(false);
    setTimeout(read, 100);
  };

  return (
    <div className="settings__sections settings__sections--wide">
      <p className="settings__intro">{words.intro}</p>
      <section className="setting-section" aria-label={words.engine}>
        <h2 className="setting-section__title engine-facts__title">
          <span className={`engine-facts__dot${engine.running ? ' engine-facts__dot--running' : ''}`} aria-hidden="true" />
          {engine.running && since !== null ? words.runningSince(formatDuration(since, locale)) : words.stopped}
        </h2>
        {engine.running && engine.model ? (
          <dl className="engine-facts">
            <dt>{words.model}</dt>
            <dd className="engine-facts__model">{engine.model.name}</dd>
            {build ? (
              <>
                <dt>{words.llama}</dt>
                <dd>{words.llamaManaged(build)}</dd>
              </>
            ) : null}
            <dt>{words.context}</dt>
            <dd>{words.contextLine(formatTokens(engine.nCtx, locale), engine.slots, engine.cacheType)}</dd>
          </dl>
        ) : null}
        <div className="setting-actions">
          {engine.running ? (
            <>
              <button
                type="button"
                className="aparte-btn aparte-btn--outline"
                disabled={engine.busy}
                onClick={() =>
                  void bridge
                    .invoke(engineUnload, undefined)
                    .catch(() => undefined)
                    .finally(read)
                }
              >
                {words.unload}
              </button>
              <button
                type="button"
                className="aparte-btn aparte-btn--outline"
                disabled={engine.busy}
                onClick={() => {
                  // What restarting costs, said before it is paid: the model's last load.
                  void bridge.invoke(engineModels, undefined).then((models) => {
                    setRestartSeconds(models.find((model) => model.path === engine.model?.path)?.announcement?.seconds ?? null);
                    setAsking(true);
                  });
                }}
              >
                {words.restart}
              </button>
            </>
          ) : null}
          {engine.busy ? (
            <p className="setting-section__hint" role="status">
              {words.busy}
            </p>
          ) : null}
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => onPage('models')}>
            {words.changeModel}
          </button>
          {/* llama.cpp, the models recommended, « Démarrer »: the first launch's panel (review of phase 9). */}
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => window.dispatchEvent(new Event(SETUP_ENGINE))}>
            {words.setup}
          </button>
        </div>
        <LaunchSettings
          messages={messages}
          locale={locale}
          idleMinutes={typeof values['idleUnloadMinutes'] === 'number' ? values['idleUnloadMinutes'] : 15}
          change={change}
          onKept={() => setTimeout(read, 100)}
        />
      </section>

      <section className="setting-section" aria-label={words.memories}>
        <div className="memory-head">
          <div>
            <h2 className="setting-section__title">{words.memories}</h2>
            <p className="setting-section__hint memory-head__intro">{words.memoriesIntro}</p>
          </div>
          <div className="memory-budget">
            <span className="memory-budget__label">{words.budget}</span>
            <span>
              {words.budgetLine(formatBytes(overview.usedBytes, style), formatBytes(overview.budgetBytes, style))}{' '}
              <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => setEditing((was) => !was)}>
                {words.budgetEdit}
              </button>
            </span>
            <progress className="memory-budget__bar" max={overview.budgetBytes} value={Math.min(overview.usedBytes, overview.budgetBytes)} />
          </div>
        </div>
        {editing ? (
          <div className="memory-budget__edit">
            <input
              className="aparte-field"
              inputMode="decimal"
              aria-label={words.budgetField}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {freed.length > 0 ? (
              <p className="setting-section__hint">{words.budgetFrees(freed.map((row) => row.title || messages.search.untitled).join(', '))}</p>
            ) : null}
            <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" disabled={newBudget === null} onClick={() => void applyBudget()}>
              {freed.length > 0 ? words.budgetFreeAndApply : words.budgetApply}
            </button>
          </div>
        ) : null}
        {overview.rows.length === 0 ? (
          <p className="setting-section__hint">{words.noMemory}</p>
        ) : (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th scope="col">{words.columns.conversation}</th>
                  <th scope="col" className="settings-table__number">
                    {words.columns.tokens}
                  </th>
                  <th scope="col" className="settings-table__number">
                    {words.columns.disk}
                  </th>
                  <th scope="col">{words.columns.last}</th>
                  <th scope="col">{words.columns.state}</th>
                  <th scope="col">
                    <span className="aparte-sr-only">{words.columns.action}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.rows.map((row) => (
                  <tr key={row.id} className="memory-row">
                    <td>{row.title || messages.search.untitled}</td>
                    <td className="settings-table__number">{formatTokens(row.tokens, locale)}</td>
                    <td className="settings-table__number">{row.bytes === null ? null : formatBytes(row.bytes, style)}</td>
                    <td>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(row.at))}</td>
                    <td>
                      <span className={`memory-state memory-state--${row.state}`}>
                        {row.state === 'engine'
                          ? words.inEngine
                          : row.state === 'saved'
                            ? row.otherModel
                              ? words.savedOther
                              : row.otherSlots
                                ? words.savedOtherSlots
                                : words.saved
                            : words.released(formatDuration(row.rereadSeconds ?? 0, locale))}
                      </span>
                    </td>
                    <td>
                      {row.state === 'saved' ? (
                        <button
                          type="button"
                          className="aparte-btn aparte-btn--outline aparte-btn--sm"
                          onClick={() => void bridge.invoke(engineReleaseMemory, { id: row.id }).then(read)}
                        >
                          {words.release}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="setting-section setting-section--quiet" aria-label={words.seed}>
        <h2 className="setting-section__title">{words.seed}</h2>
        <p className="setting-section__hint">
          {overview.seed
            ? words.seedLine(
                formatTokens(overview.seed.tokens, locale),
                overview.seed.restoreMs === null ? '—' : formatDuration(overview.seed.restoreMs / 1000, locale),
                overview.seed.served,
              )
            : words.noSeed}
        </p>
      </section>

      <dialog ref={dialog} className="aparte-dialog" aria-labelledby={questionId} onClose={() => setAsking(false)}>
        <header className="aparte-dialog__header">
          <h2 id={questionId} className="aparte-dialog__title">
            {words.restartQuestion}
          </h2>
        </header>
        <div className="aparte-dialog__body">
          <p>{words.restartCost(formatDuration(restartSeconds ?? 10, locale))}</p>
        </div>
        <footer className="aparte-dialog__footer">
          <button type="button" className="aparte-btn aparte-btn--ghost" onClick={() => setAsking(false)}>
            {words.cancel}
          </button>
          <button
            type="button"
            className="aparte-btn aparte-btn--primary aparte-btn--solid"
            onClick={() => {
              setAsking(false);
              void bridge
                .invoke(engineRestart, undefined)
                .catch(() => undefined)
                .finally(read);
            }}
          >
            {words.restartNow}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
