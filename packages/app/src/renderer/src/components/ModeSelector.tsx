import type { PlayModeDto } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

const MODES: PlayModeDto[] = ['lecture', 'repetition', 'plume', 'impro'];

interface ModeSelectorProps {
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
}

/**
 * Sélecteur de mode de jeu, monté dans le `footerLeft` du composeur.
 *
 * Le mode décide de ce que l'agent s'autorise AU PROCHAIN MESSAGE : il
 * appartient au geste d'envoyer, pas au tableau de bord — d'où sa place dans la
 * rangée basse du composeur, et non plus dans la barre de statut.
 *
 * Un `<select>` natif ne sait pas afficher deux lignes par option, et le nom
 * seul d'un mode ne dit pas ce qu'il autorise : « Impro » ne prévient de rien.
 * D'où le panneau — nom, pastille colorée, une ligne de description.
 */
export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <span className="mode-wrap" ref={wrapRef}>
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

      {open && (
        /* Le panneau s'ouvre vers le HAUT : le composeur est en bas de fenêtre. */
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
    </span>
  );
}
