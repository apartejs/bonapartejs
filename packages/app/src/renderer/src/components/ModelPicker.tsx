import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ModelPickerProps {
  busy: boolean;
  error: string | null;
  onPick: (modelPath: string, nCtx: number) => void;
}

function formatSize(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} Gio`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mio`;
}

export function ModelPicker({ busy, error, onPick }: ModelPickerProps) {
  const { t } = useTranslate();
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [nCtx, setNCtx] = useState('8192');

  const parsedNCtx = (): number => Number.parseInt(nCtx, 10) || 8192;

  useEffect(() => {
    void window.bonaparte.scanModels().then((found) => {
      setModels(found);
      if (found.length > 0) setSelected(found[0]!.path);
    });
  }, []);

  const browse = async (): Promise<void> => {
    const picked = await window.bonaparte.pickFile('gguf');
    if (picked) onPick(picked, parsedNCtx());
  };

  return (
    <div className="setup-wrap">
      <section className="setup-card">
        <p className="bp-eyebrow">{t.picker.eyebrow}</p>
        <h1>{t.picker.title}</h1>
        <p className="setup-intro">{t.picker.intro}</p>

        {models === null ? (
          <p className="picker-scanning">{t.picker.scanning}</p>
        ) : models.length === 0 ? (
          <p className="picker-empty">{t.picker.empty}</p>
        ) : (
          <ul className="model-list">
            {models.map((model) => (
              <li key={model.path}>
                <label
                  className={`model-row ${selected === model.path ? 'selected' : ''}`}
                  title={model.path}
                >
                  <input
                    type="radio"
                    name="model"
                    checked={selected === model.path}
                    onChange={() => setSelected(model.path)}
                  />
                  <span className="model-name">{model.name}</span>
                  <span className="model-meta">
                    {formatSize(model.sizeBytes)}
                    <span className={`model-source source-${model.source}`}>
                      {model.source}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <label className="field field-narrow">
          <span className="field-label">{t.picker.nCtx}</span>
          <input
            value={nCtx}
            onChange={(e) => setNCtx(e.target.value)}
            inputMode="numeric"
            spellCheck={false}
          />
        </label>

        {error && (
          <p className="setup-error">
            {t.setup.failed} — {error}
          </p>
        )}

        <div className="picker-actions">
          <button type="button" onClick={() => void browse()} disabled={busy}>
            {t.picker.manual}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !selected}
            onClick={() => selected && onPick(selected, parsedNCtx())}
          >
            {busy ? t.setup.starting : t.picker.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
