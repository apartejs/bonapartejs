import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { filterModels } from '../models/filter.js';

interface ModelSelectorProps {
  /** Model pinned by the open conversation. */
  modelName: string | null;
  busy: boolean;
  onPick: (modelPath: string) => void;
}

function sizeLabel(bytes: number, unit: string): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} ${unit}`;
}

/**
 * Conversation's model, in the composer's row.
 *
 * The model's name used to be displayed there, but as a plain label: to
 * change it, you had to create a new conversation. Yet the model belongs to
 * the conversation — on the same footing as the temperature and the play
 * mode, which are already here.
 *
 * Changing model is NOT trivial, and the menu says so: the saved KV state
 * depends on the model (it enters the manifest), so the context gets
 * rebuilt on the first message. This is the kind of information that must
 * be readable before the click, not guessed after.
 */
export function ModelSelector({ modelName, busy, onPick }: ModelSelectorProps) {
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    setModels(await window.bonaparte.scanModels());
  }, []);

  useEffect(() => {
    if (!open) return;
    // A fresh search every time the menu opens: a leftover filter would
    // hide models without saying why.
    setQuery('');
    if (models === null) void load();
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open, models, load]);

  return (
    <span className="model-wrap" ref={wrapRef}>
      <button
        type="button"
        className="model-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={busy}
        title={modelName ?? t.models.pick}
      >
        <span className="model-glyph" aria-hidden="true">
          ◈
        </span>
        <span className="model-name">{modelName ?? t.models.pick}</span>
      </button>

      {open && (
        <div className="model-menu popover" role="menu" aria-label={t.models.pick}>
          {/* The head stays put while the list scrolls: with dozens of GGUF
              files on a machine, the search is the way in, and the label
              says what this menu is even halfway down the list. */}
          <div className="model-menu-head">
            <p className="conv-menu-label">{t.models.pick}</p>
            {models !== null && models.length > 0 && (
              <span className="model-search">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t.picker.searchPlaceholder}
                  spellCheck={false}
                  autoFocus
                  aria-label={t.picker.searchPlaceholder}
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label="✕">
                    ✕
                  </button>
                )}
              </span>
            )}
          </div>
          {models === null ? (
            <p className="model-hint">{t.models.scanning}</p>
          ) : models.length === 0 ? (
            <p className="model-hint">{t.models.none}</p>
          ) : filterModels(models, query).length === 0 ? (
            <p className="model-hint">{t.picker.noMatch}</p>
          ) : (
            <>
              {filterModels(models, query).map((model) => {
                const current = modelName !== null && model.name === modelName;
                return (
                  <button
                    key={model.path}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    className="model-item"
                    disabled={current}
                    onClick={() => {
                      setOpen(false);
                      onPick(model.path);
                    }}
                    title={model.path}
                  >
                    <span className="model-item-name">{model.name}</span>
                    <span className="model-item-size">
                      {sizeLabel(model.sizeBytes, t.units.gib)}
                    </span>
                  </button>
                );
              })}
              <p className="model-hint">{t.models.switchWarning}</p>
            </>
          )}
        </div>
      )}
    </span>
  );
}
