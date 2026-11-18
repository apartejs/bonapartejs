/**
 * The first launch (task 9.6, board « Premier lancement »): the built-in engine or a service the person
 * already has. Shown until an engine is chosen — a model known, or a service added. The built-in engine
 * says what it finds (llama.cpp, the card, the models, where it looked) and recommends models to download,
 * their size said first; the context and what it takes of the card's memory; « Démarrer » with its cost. A
 * service is tested, then added, and the conversation goes there. Nothing is loaded, downloaded nor sent
 * before a click.
 *
 * Everything comes from aparté's kit: a card, boxed radio choices, a segmented choice, fields, badges,
 * alerts, a progress bar, buttons. The page only lays them out; the gauge is three bars of tokens.
 */

import {
  engineLlama,
  engineLlamaInstall,
  engineLoad,
  engineModelDownload,
  engineModels,
  engineRecommended,
  engineSettingsGet,
  modelsAddFolder,
  providersAdd,
  providersModels,
  providersProbe,
  type EngineLoadResult,
  type EngineStateView,
  type LlamaCppStateView,
  type LlamaInstallResult,
  type Locale,
  type ModelChoiceView,
  type ModelDownloadResult,
  type ProbeResultView,
  type RecommendedModelView,
} from '@aparte/bonaparte-shared';
import { useEffect, useId, useState } from 'react';
import { Glyph } from '../shell/icons';
import { TooBigCard } from '../failures/TooBigCard';
import { bridge } from '../bridge';
import { formatBytes, formatSeconds, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';

type Failure = Extract<EngineLoadResult, { ok: false }>['error'];
type InstallFailure = Extract<LlamaInstallResult, { ok: false }>['error'];
type DownloadFailure = Extract<ModelDownloadResult, { ok: false }>['error'];
type Words = Messages['engineSetup'];

/** How often the screen reads a download's progress while it runs. */
const PROGRESS_EVERY_MS = 250;

interface LlamaStatusProps {
  llama: LlamaCppStateView;
  text: Words['llama'];
  style: NumberStyle;
  downloading: boolean;
  /** A model is loading: llama.cpp is not replaced under it. */
  busy: boolean;
  failure: InstallFailure | null;
  onDownload(): void;
}

/** A download's bar: its share done, or moving when its size is not known. */
function Progress({ done, total, label }: { done: number; total: number | null; label: string }) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div
      className={`aparte-progress${percent === null ? ' aparte-progress--indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent !== null ? { 'aria-valuenow': percent } : {})}
    >
      <div className="aparte-progress__bar" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  );
}

/**
 * The llama.cpp a load runs, and keeping it up to date: the build there is, the one published and its
 * size — said before the click — the download's progress, and why it failed.
 */
function LlamaStatus({ llama, text, style, downloading, busy, failure, onDownload }: LlamaStatusProps) {
  const { current, latest } = llama;
  const build = current?.build ?? '';
  const line = !current
    ? text.none
    : current.source === 'managed'
      ? text.installed(build)
      : current.source === 'configured'
        ? text.configured(current.build)
        : text.found(build);
  const offer = llama.updateAvailable && latest ? latest : null;
  const hint = [
    offer ? text.published(offer.build) : null,
    offer && current?.source === 'path' ? text.keptUpToDate : null,
    llama.check === 'failed' ? text.checkFailed : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
  const action = offer
    ? current?.source === 'managed'
      ? text.update(formatBytes(offer.bytes, style))
      : text.download(offer.build, formatBytes(offer.bytes, style))
    : null;
  const upToDate = current !== null && current.source !== 'configured' && llama.check === 'done' && !llama.updateAvailable;
  const progress = downloading ? llama.installing : null;

  return (
    <div className="llama-status first-run__status">
      <div className="llama-status__row">
        <span className={`first-run__mark${current ? ' first-run__mark--found' : ''}`} aria-hidden="true">
          <Glyph name={current ? 'check' : 'download'} />
        </span>
        <div className="llama-status__text">
          <p className="llama-status__line">{line}</p>
          {hint ? <p className="aparte-field-hint">{hint}</p> : null}
        </div>
        {upToDate ? <span className="aparte-badge aparte-badge--success">{text.upToDate}</span> : null}
        {action && !downloading && !busy ? (
          <button
            type="button"
            className={`aparte-btn aparte-btn--sm ${current ? 'aparte-btn--surface' : 'aparte-btn--primary aparte-btn--solid'}`}
            onClick={onDownload}
          >
            {action}
          </button>
        ) : null}
      </div>

      {downloading ? (
        <div className="llama-status__progress">
          <Progress done={progress?.done ?? 0} total={progress?.total ?? null} label={text.progressLabel} />
          {progress && offer ? (
            <p className="aparte-field-hint">
              {text.downloading(offer.build, formatBytes(progress.done, style), formatBytes(progress.total ?? offer.bytes, style))}
            </p>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <div className="aparte-alert aparte-alert--danger" role="alert">
          <div className="aparte-alert__body">
            <p className="aparte-alert__title">{text.failed.title}</p>
            <p className="aparte-alert__message">{failure.code === 'digest' ? text.failed.digest : text.failed.failed}</p>
            {failure.code === 'failed' && failure.detail ? <pre className="engine-setup__log">{failure.detail}</pre> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Verdict = NonNullable<ModelChoiceView['announcement']>['verdict'];

const TONE: Record<Verdict, string> = {
  fits: 'first-run__verdict--fits',
  tight: 'first-run__verdict--tight',
  'too-big': 'first-run__verdict--too-big',
  unknown: '',
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

/** The folder a model file sits in, whatever the platform's separator. */
function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut) : path;
}

/** Thousands of tokens, as the board writes them (« 32 »). */
const kilo = (tokens: number): string => String(Math.round(tokens / 1024));

// ── The service ──

type ServiceKind = 'llamacpp' | 'ollama' | 'lmstudio' | 'openai';
const KINDS: readonly ServiceKind[] = ['llamacpp', 'ollama', 'lmstudio', 'openai'];
/** Where each kind answers by default (the core's presets); an OpenAI-compatible API has none. */
const ADDRESS: Record<ServiceKind, string> = {
  llamacpp: 'http://localhost:8080',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  openai: '',
};
/** The service's name in the model picker: the product's own, or the host of an API. */
function labelOf(kind: ServiceKind, url: string): string {
  if (kind === 'llamacpp') return 'llama.cpp';
  if (kind === 'ollama') return 'Ollama';
  if (kind === 'lmstudio') return 'LM Studio';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type Tested = { ok: true; models: number } | { ok: false; code: keyof Words['service']['errors'] };

interface ServicePanelProps {
  text: Words['service'];
  onConnected(service: { provider: string; model: string }): void;
}

function ServicePanel({ text, onConnected }: ServicePanelProps) {
  const addressId = useId();
  const keyId = useId();
  const [kind, setKind] = useState<ServiceKind>('ollama');
  const [address, setAddress] = useState(ADDRESS.ollama);
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tested, setTested] = useState<Tested | null>(null);

  const pick = (next: ServiceKind): void => {
    setKind(next);
    setAddress(ADDRESS[next]);
    setTested(null);
  };

  const probe = async (): Promise<ProbeResultView> =>
    bridge.invoke(providersProbe, { url: address.trim(), ...(key ? { key } : {}) });

  const said = (result: ProbeResultView): Tested =>
    'error' in result ? { ok: false, code: result.error } : result.models.length === 0 ? { ok: false, code: 'no-model' } : { ok: true, models: result.models.length };

  const test = async (): Promise<void> => {
    setTesting(true);
    setTested(null);
    try {
      setTested(said(await probe()));
    } catch {
      setTested({ ok: false, code: 'unreachable' });
    } finally {
      setTesting(false);
    }
  };

  const connect = async (): Promise<void> => {
    setConnecting(true);
    try {
      const result = await probe();
      const verdict = said(result);
      setTested(verdict);
      if ('error' in result || !verdict.ok) return;
      // A llama-server already running serves OpenAI's API too, at `/v1`: added as such, it goes through
      // aparté's handler like any service (the built-in engine alone speaks `/completion`).
      const url = result.kind === 'llamacpp-remote' ? `${result.url.replace(/\/+$/, '')}/v1` : result.url;
      const added = await bridge.invoke(providersAdd, {
        kind: 'openai-compat',
        label: labelOf(kind, url),
        url,
        server: kind,
        ...(key ? { key } : {}),
      });
      // The model as the service names it on its OpenAI API, else as the probe read it.
      const models = await bridge.invoke(providersModels, { id: added.id }).catch(() => [] as string[]);
      const model = models[0] ?? result.models[0];
      if (!model) {
        setTested({ ok: false, code: 'no-model' });
        return;
      }
      onConnected({ provider: added.id, model });
    } catch {
      setTested({ ok: false, code: 'failed' });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="first-run__panel">
      <div className="first-run__field">
        <span className="first-run__label">{text.which}</span>
        <div role="radiogroup" aria-label={text.label} className="aparte-segmented first-run__kinds">
          {KINDS.map((one) => (
            <label key={one} className="aparte-segmented__item">
              <input type="radio" name="first-run-service" checked={kind === one} onChange={() => pick(one)} />
              <span>{text.kinds[one]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="first-run__fields">
        <div className="first-run__field first-run__field--address">
          <label className="aparte-field-label" htmlFor={addressId}>
            {text.address}
          </label>
          <input
            id={addressId}
            type="url"
            className="aparte-field"
            value={address}
            placeholder={kind === 'openai' ? 'https://…/v1' : ADDRESS[kind]}
            onChange={(event) => {
              setAddress(event.target.value);
              setTested(null);
            }}
          />
        </div>
        <div className="first-run__field first-run__field--key">
          <label className="aparte-field-label" htmlFor={keyId}>
            {text.key}
          </label>
          <input
            id={keyId}
            type="password"
            className="aparte-field"
            value={key}
            placeholder={text.keyPlaceholder}
            autoComplete="off"
            onChange={(event) => {
              setKey(event.target.value);
              setTested(null);
            }}
          />
        </div>
      </div>

      <div className="first-run__test">
        <button
          type="button"
          className="aparte-btn aparte-btn--surface"
          disabled={testing || connecting || address.trim() === ''}
          aria-busy={testing || undefined}
          onClick={() => void test()}
        >
          {testing ? <span className="aparte-spinner" aria-hidden="true" /> : null}
          {testing ? text.testing : text.test}
        </button>
        {tested ? (
          <p
            className={`first-run__tested${tested.ok ? ' first-run__tested--ok' : ' first-run__tested--failed'}`}
            role={tested.ok ? 'status' : 'alert'}
          >
            {tested.ok ? text.connected(tested.models) : text.errors[tested.code]}
          </p>
        ) : null}
      </div>

      <div className="aparte-alert aparte-alert--warning first-run__without">
        <div className="aparte-alert__body">
          <p className="aparte-alert__title">{text.without.title}</p>
          <ul className="first-run__list">
            {text.without.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="aparte-alert__message">{text.without.later}</p>
        </div>
      </div>

      <footer className="first-run__footer">
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={connecting || testing || address.trim() === ''}
          aria-busy={connecting || undefined}
          onClick={() => void connect()}
        >
          {connecting ? <span className="aparte-spinner" aria-hidden="true" /> : null}
          {connecting ? text.connecting : text.connect}
        </button>
        <p className="engine-announcement">{text.note}</p>
      </footer>
    </div>
  );
}

// ── The screen ──

export interface FirstRunProps {
  messages: Messages;
  locale: Locale;
  /** The engine is ready: the conversation can begin. */
  onReady(state: EngineStateView): void;
  /** A service was added: the conversation begins there. */
  onService(service: { provider: string; model: string }): void;
  /** Opened again after the first launch: back to the conversations, nothing changed. */
  onBack?(): void;
}

export function FirstRun({ messages, locale, onReady, onService, onBack }: FirstRunProps) {
  const text = messages.engineSetup;
  const style: NumberStyle = { locale, units: messages.units };
  const [engine, setEngineChoice] = useState<'builtin' | 'service'>('builtin');
  const [models, setModels] = useState<ModelChoiceView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [llama, setLlama] = useState<LlamaCppStateView | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [installFailure, setInstallFailure] = useState<InstallFailure | null>(null);
  const [recommended, setRecommended] = useState<RecommendedModelView[]>([]);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchFailure, setFetchFailure] = useState<{ id: string; error: DownloadFailure } | null>(null);
  const [nCtx, setNCtx] = useState<number | null>(null);

  function listModels(choose?: string): Promise<void> {
    return bridge.invoke(engineModels, undefined).then((found) => {
      setModels(inOrder(found));
      setSelected((chosen) =>
        choose && found.some((model) => model.path === choose)
          ? choose
          : chosen && found.some((model) => model.path === chosen)
            ? chosen
            : firstChoice(found),
      );
    });
  }

  useEffect(() => {
    let current = true;
    void bridge.invoke(engineModels, undefined).then((found) => {
      if (!current) return;
      setModels(inOrder(found));
      setSelected(firstChoice(found));
    });
    // Which llama.cpp would run, and what is published: asked when the screen opens.
    void bridge.invoke(engineLlama, { checkLatest: true }).then((state) => {
      if (current) setLlama(state);
    });
    // The models recommended for this card: their size, nothing fetched.
    void bridge.invoke(engineRecommended, undefined).then((list) => {
      if (current) setRecommended(list);
    });
    void bridge.invoke(engineSettingsGet, undefined).then((settings) => {
      if (current) setNCtx(settings.nCtx);
    });
    return () => {
      current = false;
    };
  }, []);

  async function download(): Promise<void> {
    setInstallFailure(null);
    setDownloading(true);
    const timer = setInterval(() => {
      void bridge.invoke(engineLlama, {}).then(setLlama);
    }, PROGRESS_EVERY_MS);
    try {
      const result = await bridge.invoke(engineLlamaInstall, undefined);
      if (result.ok) {
        setLlama(result.state);
        // The new build says what it can use: the costs are read again.
        await listModels();
      } else {
        setInstallFailure(result.error);
      }
    } catch (error) {
      setInstallFailure({ code: 'failed', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(timer);
      setDownloading(false);
    }
  }

  async function fetchModel(model: RecommendedModelView): Promise<void> {
    setFetchFailure(null);
    setFetching(model.id);
    const timer = setInterval(() => {
      void bridge.invoke(engineRecommended, undefined).then(setRecommended);
    }, PROGRESS_EVERY_MS);
    try {
      const result = await bridge.invoke(engineModelDownload, { id: model.id });
      if (result.ok) {
        // Among the models found now, and chosen: « Démarrer » loads it.
        await listModels(result.model.path ?? undefined);
      } else {
        setFetchFailure({ id: model.id, error: result.error });
      }
    } catch (error) {
      setFetchFailure({ id: model.id, error: { code: 'failed', detail: error instanceof Error ? error.message : String(error) } });
    } finally {
      clearInterval(timer);
      setFetching(null);
      setRecommended(await bridge.invoke(engineRecommended, undefined).catch(() => recommended));
    }
  }

  const chosen = models?.find((model) => model.path === selected) ?? null;
  const cost = chosen?.announcement ?? null;

  async function start(offload = false): Promise<void> {
    if (!chosen) return;
    setLoading(true);
    setFailure(null);
    try {
      const result = await bridge.invoke(engineLoad, { path: chosen.path, ...(offload ? { offload } : {}) });
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

  const gpuBytes = models?.find((model) => model.announcement)?.announcement?.gpuBytes ?? null;
  const folders = [...new Set((models ?? []).map((model) => folderOf(model.path)))];
  const toFetch = recommended.filter((model) => model.path === null);

  // The gauge: the model, its context, and the margin the load keeps, out of the card's memory.
  const gauge =
    chosen && cost && nCtx !== null
      ? (() => {
          const context = (chosen.kvBytesPerToken ?? 0) * nCtx;
          const margin = Math.max(0, cost.vramBytes - chosen.sizeBytes - context);
          const total = cost.gpuBytes ?? cost.vramBytes;
          const share = (bytes: number): string => `${Math.min(100, (bytes / total) * 100)}%`;
          return { context, margin, total, share };
        })()
      : null;

  return (
    <section className="engine-setup first-run" aria-labelledby="engine-setup-title">
      <div className="aparte-card engine-setup__card first-run__card">
        <header className="aparte-card__header engine-setup__header">
          <div className="first-run__top">
            <p className="first-run__brand">{text.brand}</p>
            {onBack ? (
              <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--ghost" onClick={onBack}>
                {text.back}
              </button>
            ) : null}
          </div>
          <h1 id="engine-setup-title" className="engine-setup__title">
            {text.title}
          </h1>
          <p className="engine-setup__lede">{text.lede}</p>
        </header>

        <div className="aparte-card__body engine-setup__body">
          <div role="radiogroup" aria-label={text.engines.label} className="first-run__engines">
            <label className={`aparte-field-choice aparte-field-choice--boxed first-run__engine${engine === 'builtin' ? ' aparte-field-choice--selected' : ''}`}>
              <input type="radio" className="aparte-radio" name="first-run-engine" checked={engine === 'builtin'} onChange={() => setEngineChoice('builtin')} />
              <span className="aparte-field-choice__body">
                <span className="first-run__engine-title">
                  <strong>{text.engines.builtin}</strong>
                  <span className="aparte-badge aparte-badge--success">{text.engines.recommended}</span>
                </span>
                <span className="aparte-field-hint">{text.engines.builtinHint}</span>
              </span>
            </label>
            <label className={`aparte-field-choice aparte-field-choice--boxed first-run__engine${engine === 'service' ? ' aparte-field-choice--selected' : ''}`}>
              <input type="radio" className="aparte-radio" name="first-run-engine" checked={engine === 'service'} onChange={() => setEngineChoice('service')} />
              <span className="aparte-field-choice__body">
                <strong>{text.engines.service}</strong>
                <span className="aparte-field-hint">{text.engines.serviceHint}</span>
              </span>
            </label>
          </div>

          {engine === 'service' ? (
            <ServicePanel text={text.service} onConnected={onService} />
          ) : (
            <div className="first-run__panel">
              <div className="first-run__found">
                {llama ? (
                  <LlamaStatus
                    llama={llama}
                    text={text.llama}
                    style={style}
                    downloading={downloading}
                    busy={loading}
                    failure={installFailure}
                    onDownload={() => void download()}
                  />
                ) : null}
                <div className="first-run__status first-run__gpu">
                  <span className={`first-run__mark${gpuBytes !== null ? ' first-run__mark--found' : ''}`} aria-hidden="true">
                    <Glyph name={gpuBytes !== null ? 'check' : 'info'} />
                  </span>
                  <div className="llama-status__text">
                    <p className="llama-status__line">{text.gpu.title}</p>
                    <p className="aparte-field-hint">{gpuBytes !== null ? text.gpu.memory(formatBytes(gpuBytes, style)) : text.gpu.unknown}</p>
                  </div>
                </div>
              </div>

              {models === null ? (
                <p className="engine-setup__searching" role="status">
                  <span className="aparte-spinner aparte-spinner--sm" aria-hidden="true" />
                  {text.searching}
                </p>
              ) : (
                <fieldset className="aparte-fieldset first-run__models" disabled={loading}>
                  <legend>{text.modelsLegend}</legend>
                  {models.length === 0 ? (
                    <div className="engine-setup__empty">
                      <p className="engine-setup__empty-title">{text.empty.title}</p>
                      <p className="aparte-field-hint">{text.empty.body}</p>
                    </div>
                  ) : (
                    <>
                      <div className="first-run__columns" aria-hidden="true">
                        <span>{text.columns.file}</span>
                        <span>{text.columns.size}</span>
                        <span>{text.columns.perToken}</span>
                        <span>{text.columns.vram(kilo(nCtx ?? 32_768))}</span>
                      </div>
                      {models.map((model) => (
                        <label
                          key={model.path}
                          className={`aparte-field-choice aparte-field-choice--boxed model-row${model.path === selected ? ' aparte-field-choice--selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="engine-model"
                            className="aparte-radio"
                            checked={model.path === selected}
                            disabled={!loadable(model)}
                            onChange={() => setSelected(model.path)}
                          />
                          <span className="aparte-field-choice__body model-row__file">
                            <span className="model-row__name">{model.name}</span>
                            {model.family ? <span className="aparte-field-hint">{messages.families[model.family]}</span> : null}
                            {model.problem ? <span className="aparte-field-warning">{text.problem[model.problem]}</span> : null}
                          </span>
                          <span className="model-row__figure">{formatBytes(model.sizeBytes, style)}</span>
                          <span className="model-row__figure">{model.kvBytesPerToken ? formatBytes(model.kvBytesPerToken, style) : ''}</span>
                          <span className={`model-row__figure model-row__verdict ${model.announcement ? TONE[model.announcement.verdict] : ''}`}>
                            {loadable(model) && model.announcement
                              ? `${formatBytes(model.announcement.vramBytes, style)} · ${text.verdict[model.announcement.verdict]}`
                              : ''}
                          </span>
                        </label>
                      ))}
                    </>
                  )}
                  <p className="first-run__where">
                    {folders.length > 0 ? (
                      <>
                        <span>{text.foundIn}</span>
                        {folders.map((folder) => (
                          <code key={folder}>{folder}</code>
                        ))}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--sm aparte-btn--ghost aparte-btn--primary first-run__add"
                      onClick={() => {
                        void bridge.invoke(modelsAddFolder, undefined).then((next) => {
                          if (next) void listModels();
                        });
                      }}
                    >
                      {text.addFolder}
                    </button>
                  </p>
                </fieldset>
              )}

              {toFetch.length > 0 ? (
                <section className="first-run__recommended" aria-labelledby="first-run-recommended">
                  <h2 id="first-run-recommended" className="first-run__label">
                    {text.recommended.title}
                  </h2>
                  <p className="aparte-field-hint">{text.recommended.hint}</p>
                  {toFetch.map((model) => (
                    <div key={model.id} className="recommended-row">
                      <div className="recommended-row__head">
                        <span className="recommended-row__name">
                          <strong>{model.name}</strong>
                          <span className="aparte-field-hint">{messages.families[model.family]}</span>
                        </span>
                        {fetching === model.id ? null : (
                          <button
                            type="button"
                            className="aparte-btn aparte-btn--sm aparte-btn--surface"
                            disabled={fetching !== null || loading}
                            onClick={() => void fetchModel(model)}
                          >
                            {text.recommended.download(formatBytes(model.bytes, style))}
                          </button>
                        )}
                      </div>
                      {fetching === model.id ? (
                        <div className="llama-status__progress">
                          <Progress
                            done={model.downloading?.done ?? 0}
                            total={model.downloading?.total ?? model.bytes}
                            label={text.recommended.progressLabel(model.name)}
                          />
                          <p className="aparte-field-hint">
                            {text.recommended.progress(formatBytes(model.downloading?.done ?? 0, style), formatBytes(model.bytes, style))}
                          </p>
                        </div>
                      ) : null}
                      {fetchFailure?.id === model.id ? (
                        <p className="aparte-field-warning" role="alert">
                          {fetchFailure.error.code === 'digest' ? text.recommended.failed.digest : text.recommended.failed.failed}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}

              {gauge && cost && chosen && nCtx !== null ? (
                <div className="first-run__context">
                  <p className="first-run__label">{text.context.label(kilo(nCtx))}</p>
                  <div
                    className="first-run__gauge"
                    role="img"
                    aria-label={text.context.gauge(formatBytes(cost.vramBytes, style), formatBytes(gauge.total, style))}
                  >
                    <span className="first-run__gauge-model" style={{ width: gauge.share(chosen.sizeBytes) }} />
                    <span className="first-run__gauge-context" style={{ width: gauge.share(gauge.context) }} />
                    <span className="first-run__gauge-margin" style={{ width: gauge.share(gauge.margin) }} />
                  </div>
                  <p className="first-run__legend">
                    <strong>{text.context.total(formatBytes(cost.vramBytes, style), formatBytes(gauge.total, style))}</strong>
                    <span className="first-run__key first-run__key--model">{text.context.model(formatBytes(chosen.sizeBytes, style))}</span>
                    <span className="first-run__key first-run__key--context">{text.context.kv(formatBytes(gauge.context, style))}</span>
                    <span className="first-run__key first-run__key--margin">{text.context.margin(formatBytes(gauge.margin, style))}</span>
                  </p>
                </div>
              ) : null}

              {failure?.code === 'too-big' && failure.tooBig && chosen ? (
                <TooBigCard
                  messages={messages}
                  style={style}
                  model={chosen.name}
                  tooBig={failure.tooBig}
                  busy={loading}
                  onOffload={() => void start(true)}
                  onSmaller={() => {
                    setFailure(null);
                    document.querySelector<HTMLElement>('.first-run__models input:checked, .first-run__models input')?.focus();
                  }}
                />
              ) : failure ? (
                <div className="aparte-alert aparte-alert--danger engine-setup__failure" role="alert">
                  <div className="aparte-alert__body">
                    <p className="aparte-alert__title">{text.failed.title}</p>
                    <p className="aparte-alert__message">{text.failed.reason[failure.code]}</p>
                    {failure.code === 'failed' && failure.detail ? <pre className="engine-setup__log">{failure.detail}</pre> : null}
                  </div>
                </div>
              ) : null}

              <footer className="first-run__footer" hidden={models?.length === 0}>
                <button
                  type="button"
                  className="aparte-btn aparte-btn--primary aparte-btn--solid"
                  // Nothing to run without llama.cpp, nor while a build or a model is being downloaded.
                  disabled={!chosen || !loadable(chosen) || loading || downloading || fetching !== null || (llama !== null && llama.current === null)}
                  aria-busy={loading}
                  onClick={() => void start()}
                >
                  {/* A busy kit button lays out its spinner, at its icon's size and in its ink (aparté 1.9). */}
                  {loading ? <span className="aparte-spinner" aria-hidden="true" /> : null}
                  {loading ? text.starting : text.start}
                </button>
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
              </footer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
