import type { PlayModeDto } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

const MODES: PlayModeDto[] = ['lecture', 'repetition', 'plume', 'impro'];

interface ComposerBarProps {
  mode: PlayModeDto;
  modelName: string | null;
  onModeChange: (mode: PlayModeDto) => void;
}

/**
 * Rangée basse du composeur : ce qui conditionne LE PROCHAIN message.
 *
 * Le mode de jeu était dans la barre de statut, avec l'état du moteur — deux
 * choses de nature différente. Le mode décide de ce que l'agent s'autorise au
 * tour suivant : il appartient donc au geste d'envoyer, pas au tableau de bord.
 * (Même conclusion que Codex, qui met « Approuver à ma place » et le sélecteur
 * de modèle dans la rangée basse de son composeur.)
 *
 * Un `<select>` natif ne sait pas afficher deux lignes par option, et le nom
 * seul d'un mode ne dit pas ce qu'il autorise. D'où le panneau : nom + une
 * ligne de description, pour choisir sans avoir à deviner.
 */
export function ComposerBar({ mode, modelName, onModeChange }: ComposerBarProps) {
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="composer-bar">
      <div className="composer-bar-inner" ref={wrapRef}>
        <button
          type="button"
          className={`mode-button mode-${mode}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={t.modes.hint}
        >
          <span className="mode-dot" aria-hidden="true" />
          {t.modes[mode]}
          <span className="mode-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {modelName && (
          <span className="composer-model" title={modelName}>
            {modelName}
          </span>
        )}

        {open && (
          <div className="mode-menu" role="menu">
            <p className="conv-menu-label">{t.modes.hint}</p>
            {MODES.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === mode}
                className={`mode-option${value === mode ? ' mode-option-active' : ''}`}
                onClick={() => {
                  onModeChange(value);
                  setOpen(false);
                }}
              >
                <span className="mode-option-head">
                  <span className={`mode-dot mode-${value}`} aria-hidden="true" />
                  {t.modes[value]}
                </span>
                <span className="mode-option-desc">{t.modes.descriptions[value]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
