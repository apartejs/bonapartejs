import type { PlayModeDto } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

const MODES: PlayModeDto[] = ['lecture', 'repetition', 'plume', 'impro'];

interface ModeSelectorProps {
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
}

/**
 * Play mode selector, mounted in the composer's `footerLeft`.
 *
 * The mode decides what the agent is allowed to do ON THE NEXT MESSAGE: it
 * belongs to the act of sending, not to the dashboard — hence its place in
 * the composer's bottom row, no longer in the status bar.
 *
 * A native `<select>` can't display two lines per option, and a mode's name
 * alone doesn't say what it allows: "Improv" doesn't warn of anything. Hence
 * the panel — name, colored dot, one line of description.
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
        /* The panel opens UPWARD: the composer is at the bottom of the window. */
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
