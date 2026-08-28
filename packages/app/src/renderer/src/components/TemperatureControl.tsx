import { localize, type ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface TemperatureControlProps {
  /** Changes on every open conversation: the value is carried by it. */
  conversationId: string | null;
}

/**
 * Conversation's temperature, in the composer's row.
 *
 * It used to be in the tooling panel, on the right, with the "advanced"
 * settings. That was the wrong place: temperature isn't a workshop setting,
 * it's what decides the tone of the NEXT message — same family as the play
 * mode and the model, hence the same spot.
 *
 * Sampling changes on the fly: unlike launch parameters, it doesn't enter
 * the KV manifest and therefore invalidates no saved state. It can be moved
 * mid-conversation at no cost, and that's precisely what justifies putting
 * it within reach.
 */
export function TemperatureControl({ conversationId }: TemperatureControlProps) {
  const { t, locale } = useTranslate();
  const [setting, setSetting] = useState<ResolvedSettingDto | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    const all = await window.bonaparte.getSettings('conversation');
    setSetting(all.find((entry) => entry.key === 'temperature') ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, conversationId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const change = useCallback(
    async (value: number) => {
      // Optimistic: the slider must follow the finger, not the IPC round trip.
      setSetting((current) => (current ? { ...current, value, overridden: true } : current));
      await window.bonaparte.setSetting('conversation', 'temperature', value);
      await load();
    },
    [load],
  );

  const reset = useCallback(async () => {
    await window.bonaparte.setSetting('conversation', 'temperature', undefined);
    await load();
  }, [load]);

  if (!setting) return null;

  const value = typeof setting.value === 'number' ? setting.value : 0.7;
  const min = setting.min ?? 0;
  const max = setting.max ?? 2;

  return (
    <span className="temp-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`temp-button aparte-btn aparte-btn--neutral aparte-btn--pill aparte-btn--sm ${
          setting.overridden ? 'temp-button-set aparte-btn--soft' : 'aparte-btn--ghost'
        }`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={`${t.temperature.label} — ${
          setting.overridden ? t.temperature.thisConversation : t.settings.inherited
        }`}
      >
        <span className="temp-glyph aparte-btn__icon" aria-hidden="true">
          ◑
        </span>
        {value.toLocaleString()}
      </button>

      {open && (
        <div className="temp-menu aparte-popover" role="dialog" aria-label={t.temperature.label}>
          <p className="conv-menu-label">{t.temperature.label}</p>
          <input
            type="range"
            className="aparte-range"
            min={min}
            max={max}
            step={setting.step ?? 0.05}
            value={value}
            onChange={(e) => void change(Number(e.target.value))}
            aria-label={t.temperature.label}
          />
          <div className="temp-row">
            <span className="temp-value">{value.toLocaleString()}</span>
            {/* The origin is stated: without it, you can't tell whether
                you're adjusting this conversation or reading the global
                default. */}
            <span className="temp-origin">
              {setting.overridden ? t.temperature.thisConversation : t.settings.inherited}
            </span>
            {setting.overridden && (
              <button
                type="button"
                className="temp-reset aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
                onClick={() => void reset()}
              >
                {t.settings.reset}
              </button>
            )}
          </div>
          {setting.description && (
            <p className="temp-help">{localize(setting.description, locale)}</p>
          )}
        </div>
      )}
    </span>
  );
}
