import type { BackendConfigDto, PickFileKind } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface SetupPanelProps {
  initial?: BackendConfigDto;
  busy: boolean;
  error: string | null;
  onSubmit: (config: BackendConfigDto) => void;
}

export function SetupPanel({ initial, busy, error, onSubmit }: SetupPanelProps) {
  const { t } = useTranslate();
  // Local-first : le mode managé (local) est le défaut.
  const [mode, setMode] = useState<BackendConfigDto['mode']>(
    initial?.mode ?? 'managed',
  );
  const [url, setUrl] = useState(initial?.mode === 'remote' ? initial.url : '');
  const [endpointUrl, setEndpointUrl] = useState(
    initial?.mode === 'openai-compat' ? initial.baseUrl : 'http://127.0.0.1:1234/v1',
  );
  const [endpointModels, setEndpointModels] = useState<string[] | null>(null);
  const [endpointModel, setEndpointModel] = useState(
    initial?.mode === 'openai-compat' ? initial.model : '',
  );
  const [probing, setProbing] = useState(false);

  const probeEndpoint = async (): Promise<void> => {
    setProbing(true);
    try {
      const models = await window.bonaparte.listEndpointModels(endpointUrl.trim());
      setEndpointModels(models);
      setEndpointModel((current) => current || (models[0] ?? ''));
    } catch {
      setEndpointModels([]);
    } finally {
      setProbing(false);
    }
  };
  const [binPath, setBinPath] = useState(
    initial?.mode === 'managed' ? initial.binPath : '',
  );
  const [binDetected, setBinDetected] = useState(false);
  const [binMissing, setBinMissing] = useState(false);
  const [wingetCopied, setWingetCopied] = useState(false);

  // Pré-remplit le binaire llama détecté sur la machine (doctor lookup).
  useEffect(() => {
    void window.bonaparte.suggestSetup().then((suggestion) => {
      if (suggestion.binPath) {
        setBinPath((current) => {
          if (current) return current;
          setBinDetected(true);
          return suggestion.binPath as string;
        });
      } else {
        setBinMissing(true);
      }
    });
  }, []);

  const copyWinget = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText('winget install ggml.llamacpp');
      setWingetCopied(true);
      setTimeout(() => setWingetCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible : la commande reste affichée */
    }
  };

  const browse = async (kind: PickFileKind): Promise<void> => {
    const picked = await window.bonaparte.pickFile(kind);
    if (!picked) return;
    setBinPath(picked);
    setBinDetected(false);
  };

  const canSubmit =
    !busy &&
    (mode === 'remote'
      ? url.trim() !== ''
      : mode === 'openai-compat'
        ? endpointUrl.trim() !== '' && endpointModel !== ''
        : binPath.trim() !== '');

  const submit = (): void => {
    if (!canSubmit) return;
    if (mode === 'remote') onSubmit({ mode: 'remote', url: url.trim() });
    else if (mode === 'openai-compat') {
      onSubmit({
        mode: 'openai-compat',
        baseUrl: endpointUrl.trim().replace(/\/$/, ''),
        model: endpointModel,
      });
    } else onSubmit({ mode: 'managed', binPath: binPath.trim() });
  };

  return (
    <div className="setup-wrap">
      <section className="setup-card">
        <p className="bp-eyebrow">{t.setup.eyebrow}</p>
        <h1>{t.setup.title}</h1>
        <p className="setup-intro">{t.setup.intro}</p>

        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'managed'}
            className={mode === 'managed' ? 'active' : ''}
            onClick={() => setMode('managed')}
          >
            {t.setup.modeManaged}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'remote'}
            className={mode === 'remote' ? 'active' : ''}
            onClick={() => setMode('remote')}
          >
            {t.setup.modeRemote}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'openai-compat'}
            className={mode === 'openai-compat' ? 'active' : ''}
            onClick={() => setMode('openai-compat')}
          >
            {t.setup.modeEndpoint}
          </button>
        </div>

        {mode === 'openai-compat' ? (
          <>
            <p className="setup-note">{t.setup.endpointNote}</p>
            <label className="field">
              <span className="field-label">{t.setup.endpointUrl}</span>
              <span className="field-row">
                <input
                  value={endpointUrl}
                  onChange={(e) => {
                    setEndpointUrl(e.target.value);
                    setEndpointModels(null);
                  }}
                  placeholder="http://127.0.0.1:1234/v1"
                  spellCheck={false}
                />
                <button type="button" onClick={() => void probeEndpoint()} disabled={probing}>
                  {probing ? t.setup.starting : t.setup.endpointProbe}
                </button>
              </span>
            </label>
            {endpointModels !== null && (
              <label className="field">
                <span className="field-label">{t.setup.endpointModel}</span>
                {endpointModels.length === 0 ? (
                  <p className="picker-empty">{t.setup.endpointEmpty}</p>
                ) : (
                  <select
                    className="field-select"
                    value={endpointModel}
                    onChange={(e) => setEndpointModel(e.target.value)}
                  >
                    {endpointModels.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
          </>
        ) : mode === 'remote' ? (
          <label className="field">
            <span className="field-label">{t.setup.url}</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t.setup.urlPlaceholder}
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field-label">
                {t.setup.binPath}
                {binDetected && (
                  <em className="field-hint"> — {t.setup.detected}</em>
                )}
              </span>
              <span className="field-row">
                <input
                  value={binPath}
                  onChange={(e) => {
                    setBinPath(e.target.value);
                    setBinDetected(false);
                  }}
                  placeholder={t.setup.binPathPlaceholder}
                  spellCheck={false}
                />
                <button type="button" onClick={() => void browse('binary')}>
                  {t.setup.browse}
                </button>
              </span>
            </label>
            {binMissing && !binPath && (
              <div className="install-hint">
                <p>{t.setup.notInstalled}</p>
                <code>winget install ggml.llamacpp</code>
                <div className="install-hint-actions">
                  <button type="button" onClick={() => void copyWinget()}>
                    {wingetCopied ? '✓' : t.setup.installWinget}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.bonaparte.openExternal(
                        'https://github.com/ggml-org/llama.cpp/releases',
                      )
                    }
                  >
                    {t.setup.openReleases}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="setup-error">
            {t.setup.failed} — {error}
          </p>
        )}

        <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>
          {busy ? t.setup.starting : t.setup.start}
        </button>
      </section>
    </div>
  );
}
