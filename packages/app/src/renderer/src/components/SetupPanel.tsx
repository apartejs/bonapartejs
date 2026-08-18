import type { BackendConfigDto } from '@aparte/bonaparte-shared';
import { useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface SetupPanelProps {
  initial?: BackendConfigDto;
  busy: boolean;
  error: string | null;
  onSubmit: (config: BackendConfigDto) => void;
}

export function SetupPanel({ initial, busy, error, onSubmit }: SetupPanelProps) {
  const { t } = useTranslate();
  const [mode, setMode] = useState<'remote' | 'managed'>(initial?.mode ?? 'remote');
  const [url, setUrl] = useState(initial?.mode === 'remote' ? initial.url : '');
  const [binPath, setBinPath] = useState(
    initial?.mode === 'managed' ? initial.binPath : '',
  );
  const [modelPath, setModelPath] = useState(
    initial?.mode === 'managed' ? initial.modelPath : '',
  );
  const [nCtx, setNCtx] = useState(
    initial?.mode === 'managed' && initial.nCtx ? String(initial.nCtx) : '8192',
  );

  const canSubmit =
    !busy && (mode === 'remote' ? url.trim() !== '' : binPath.trim() !== '' && modelPath.trim() !== '');

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(
      mode === 'remote'
        ? { mode: 'remote', url: url.trim() }
        : {
            mode: 'managed',
            binPath: binPath.trim(),
            modelPath: modelPath.trim(),
            nCtx: Number.parseInt(nCtx, 10) || 8192,
          },
    );
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
            aria-selected={mode === 'remote'}
            className={mode === 'remote' ? 'active' : ''}
            onClick={() => setMode('remote')}
          >
            {t.setup.modeRemote}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'managed'}
            className={mode === 'managed' ? 'active' : ''}
            onClick={() => setMode('managed')}
          >
            {t.setup.modeManaged}
          </button>
        </div>

        {mode === 'remote' ? (
          <label className="field">
            <span>{t.setup.url}</span>
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
              <span>{t.setup.binPath}</span>
              <input
                value={binPath}
                onChange={(e) => setBinPath(e.target.value)}
                placeholder={t.setup.binPathPlaceholder}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>{t.setup.modelPath}</span>
              <input
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                placeholder={t.setup.modelPathPlaceholder}
                spellCheck={false}
              />
            </label>
            <label className="field field-narrow">
              <span>{t.setup.nCtx}</span>
              <input
                value={nCtx}
                onChange={(e) => setNCtx(e.target.value)}
                inputMode="numeric"
                spellCheck={false}
              />
            </label>
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
