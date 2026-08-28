import type {
  BackendConfigDto,
  EndpointProbeDto,
  PickFileKind,
} from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface SetupPanelProps {
  initial?: BackendConfigDto;
  busy: boolean;
  error: string | null;
  onSubmit: (config: BackendConfigDto) => void;
}

/**
 * Two intents for a single engine: "bonaparte launches llama.cpp" or "I
 * already have a llama-server running." There's no protocol to choose —
 * bonaparte only drives llama.cpp, the only one that persists context. The
 * URL is simply verified before being accepted.
 */
type Intent = 'managed' | 'existing';

export function SetupPanel({ initial, busy, error, onSubmit }: SetupPanelProps) {
  const { t } = useTranslate();
  const [intent, setIntent] = useState<Intent>(
    initial && initial.mode !== 'managed' ? 'existing' : 'managed',
  );

  const [binPath, setBinPath] = useState(
    initial?.mode === 'managed' ? initial.binPath : '',
  );
  const [binDetected, setBinDetected] = useState(false);
  const [binMissing, setBinMissing] = useState(false);
  const [wingetCopied, setWingetCopied] = useState(false);

  const [url, setUrl] = useState(initial?.mode === 'remote' ? initial.url : '');
  const [probe, setProbe] = useState<EndpointProbeDto | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);

  // Pre-fills the llama binary detected on the machine (doctor lookup).
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
      /* clipboard unavailable: the command stays displayed */
    }
  };

  const browse = async (kind: PickFileKind): Promise<void> => {
    const picked = await window.bonaparte.pickFile(kind);
    if (!picked) return;
    setBinPath(picked);
    setBinDetected(false);
  };

  const runProbe = async (): Promise<void> => {
    setProbing(true);
    setProbeFailed(false);
    try {
      const found = await window.bonaparte.probeEndpoint(url);
      setProbe(found);
      setProbeFailed(found === null);
    } finally {
      setProbing(false);
    }
  };

  const canSubmit =
    !busy && (intent === 'managed' ? binPath.trim() !== '' : probe !== null);

  const submit = (): void => {
    if (!canSubmit) return;
    if (intent === 'managed') {
      onSubmit({ mode: 'managed', binPath: binPath.trim() });
      return;
    }
    if (!probe) return;
    onSubmit({ mode: 'remote', url: probe.baseUrl });
  };

  return (
    <div className="setup-wrap">
      <section className="setup-card">
        <p className="bp-eyebrow">{t.setup.eyebrow}</p>
        <h1>{t.setup.title}</h1>
        <p className="setup-intro">{t.setup.intro}</p>

        <div className="segmented aparte-tabs aparte-tabs--segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={intent === 'managed'}
            className={`aparte-tabs__tab${intent === 'managed' ? ' active' : ''}`}
            onClick={() => setIntent('managed')}
          >
            {t.setup.intentManaged}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={intent === 'existing'}
            className={`aparte-tabs__tab${intent === 'existing' ? ' active' : ''}`}
            onClick={() => setIntent('existing')}
          >
            {t.setup.intentExisting}
          </button>
        </div>

        {intent === 'managed' ? (
          <>
            <p className="setup-note">{t.setup.managedNote}</p>
            <label className="field">
              <span className="field-label aparte-field-label">
                {t.setup.binPath}
                {binDetected && (
                  <em className="field-hint aparte-field-hint"> — {t.setup.detected}</em>
                )}
              </span>
              <span className="field-row aparte-field-group">
                <input
                  className="aparte-field"
                  value={binPath}
                  onChange={(e) => {
                    setBinPath(e.target.value);
                    setBinDetected(false);
                  }}
                  placeholder={t.setup.binPathPlaceholder}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="aparte-field-group__suffix aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
                  onClick={() => void browse('binary')}
                >
                  {t.setup.browse}
                </button>
              </span>
            </label>
            {binMissing && !binPath && (
              <div className="install-hint aparte-alert aparte-alert--info">
                <div className="aparte-alert__body">
                  <p className="aparte-alert__message">{t.setup.notInstalled}</p>
                  <code>winget install ggml.llamacpp</code>
                  <div className="install-hint-actions">
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--neutral aparte-btn--soft aparte-btn--sm"
                      onClick={() => void copyWinget()}
                    >
                      {wingetCopied ? '✓' : t.setup.installWinget}
                    </button>
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--neutral aparte-btn--outline aparte-btn--sm"
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
              </div>
            )}
          </>
        ) : (
          <>
            <p className="setup-note">{t.setup.existingNote}</p>
            <label className="field">
              <span className="field-label aparte-field-label">{t.setup.endpointUrl}</span>
              <span className="field-row aparte-field-group">
                <input
                  className="aparte-field"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbe(null);
                    setProbeFailed(false);
                  }}
                  placeholder="http://127.0.0.1:1234/v1"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="aparte-field-group__suffix aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
                  onClick={() => void runProbe()}
                  disabled={probing || url.trim() === ''}
                >
                  {probing ? t.setup.probing : t.setup.endpointProbe}
                </button>
              </span>
            </label>

            {probeFailed && (
              <div className="setup-error aparte-alert aparte-alert--danger" role="alert">
                <div className="aparte-alert__body">
                  <p className="aparte-alert__message">{t.setup.probeFailed}</p>
                </div>
              </div>
            )}

            {probe && (
              <div className="probe-result aparte-alert aparte-alert--success">
                <div className="aparte-alert__body">
                  <p className="aparte-alert__message">
                    <strong>{t.setup.foundLlama}</strong>
                    {' — '}
                    {t.setup.persistenceYes}
                  </p>
                  {probe.model && <p className="probe-model">{probe.model}</p>}
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="setup-error aparte-alert aparte-alert--danger" role="alert">
            <div className="aparte-alert__body">
              <p className="aparte-alert__message">
                {t.setup.failed} — {error}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          className="primary aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--lg"
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? t.setup.starting : t.setup.start}
        </button>
      </section>
    </div>
  );
}
