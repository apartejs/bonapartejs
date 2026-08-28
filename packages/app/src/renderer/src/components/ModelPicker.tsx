import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { modelFileName } from '../models/filter.js';

interface ModelPickerProps {
  busy: boolean;
  error: string | null;
  onPick: (modelPath: string) => void;
  /** Pinned model whose file vanished: named in a notice above the list. */
  missingModel?: string | null;
  /** A message waits for this pick: the notice says it will be sent. */
  pendingMessage?: boolean;
}

function formatSize(bytes: number, units: { gib: string; mib: string }): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} ${units.gib}`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} ${units.mib}`;
}

export function ModelPicker({
  busy,
  error,
  onPick,
  missingModel,
  pendingMessage,
}: ModelPickerProps) {
  const { t } = useTranslate();
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Filter: each term must appear in the name OR the path, which allows
  // searching "qwen 32 q4" without worrying about order.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (models ?? []).filter((model) => {
    const haystack = `${model.name} ${model.path}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  // We never confirm a selection hidden by the filter: if it falls out of
  // the visible list, the first displayed row becomes the authoritative one.
  const effective =
    selected && visible.some((m) => m.path === selected)
      ? selected
      : (visible[0]?.path ?? null);

  useEffect(() => {
    void window.bonaparte.scanModels().then((found) => {
      setModels(found);
      if (found.length > 0) setSelected(found[0]!.path);
    });
  }, []);

  const browse = async (): Promise<void> => {
    const picked = await window.bonaparte.pickFile('gguf');
    if (picked) onPick(picked);
  };

  return (
    <div className="setup-wrap">
      <section className="setup-card">
        <p className="bp-eyebrow">{t.picker.eyebrow}</p>
        <h1>{t.picker.title}</h1>
        <p className="setup-intro">{t.picker.intro}</p>

        {missingModel && (
          <div className="aparte-alert aparte-alert--warning picker-missing" role="status">
            <div className="aparte-alert__body">
              <p className="aparte-alert__message">
                {t.picker.missingModel.replace('{name}', modelFileName(missingModel))}
                {pendingMessage ? ` ${t.picker.resendAfterPick}` : ''}
              </p>
            </div>
          </div>
        )}

        {models !== null && models.length > 0 && (
          <label className="field picker-search">
            <span className="field-row aparte-field-group">
              <input
                className="aparte-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.picker.searchPlaceholder}
                spellCheck={false}
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  className="aparte-field-group__suffix aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--icon aparte-btn--sm"
                  aria-label={t.common.clear}
                  onClick={() => setQuery('')}
                >
                  ✕
                </button>
              )}
            </span>
          </label>
        )}

        {models === null ? (
          <p className="picker-scanning">{t.picker.scanning}</p>
        ) : models.length === 0 ? (
          <p className="picker-empty">{t.picker.empty}</p>
        ) : visible.length === 0 ? (
          <p className="picker-empty">{t.picker.noMatch}</p>
        ) : (
          <ul className="model-list">
            {visible.map((model) => (
              <li key={model.path}>
                <label
                  className={`model-row aparte-field-choice aparte-field-choice--boxed ${effective === model.path ? 'selected aparte-field-choice--selected' : ''}`}
                  title={model.path}
                >
                  <input
                    type="radio"
                    name="model"
                    className="aparte-radio"
                    checked={effective === model.path}
                    onChange={() => setSelected(model.path)}
                  />
                  <span className="model-name">{model.name}</span>
                  <span className="model-meta">
                    {formatSize(model.sizeBytes, t.units)}
                    <span
                      className={`model-source source-${model.source} aparte-badge aparte-badge--neutral aparte-badge--outline aparte-badge--sm`}
                    >
                      {model.source}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
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

        <div className="picker-actions">
          <button
            type="button"
            className="aparte-btn aparte-btn--neutral aparte-btn--outline"
            onClick={() => void browse()}
            disabled={busy}
          >
            {t.picker.manual}
          </button>
          <button
            type="button"
            className="primary aparte-btn aparte-btn--primary aparte-btn--solid"
            disabled={busy || !effective}
            onClick={() => effective && onPick(effective)}
          >
            {busy ? t.setup.starting : t.picker.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
