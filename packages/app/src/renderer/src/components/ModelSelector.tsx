import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ModelSelectorProps {
  /** Modèle épinglé par la conversation ouverte. */
  modelName: string | null;
  busy: boolean;
  onPick: (modelPath: string) => void;
}

function sizeLabel(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

/**
 * Modèle de la conversation, dans la rangée du composeur.
 *
 * Le nom du modèle était affiché là, mais en simple étiquette : pour en changer
 * il fallait créer une conversation. Or le modèle appartient à la conversation
 * — au même titre que la température et le mode de jeu, qui sont déjà ici.
 *
 * Changer de modèle n'est PAS anodin, et le menu le dit : l'état KV sauvegardé
 * dépend du modèle (il entre dans le manifeste), donc le contexte est
 * reconstruit au premier message. C'est le genre d'information qui doit être
 * lisible avant le clic, pas devinée après.
 */
export function ModelSelector({ modelName, busy, onPick }: ModelSelectorProps) {
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    setModels(await window.bonaparte.scanModels());
  }, []);

  useEffect(() => {
    if (!open) return;
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
          <p className="conv-menu-label">{t.models.pick}</p>
          {models === null ? (
            <p className="model-hint">{t.models.scanning}</p>
          ) : models.length === 0 ? (
            <p className="model-hint">{t.models.none}</p>
          ) : (
            <>
              {models.map((model) => {
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
                    <span className="model-item-size">{sizeLabel(model.sizeBytes)}</span>
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
