import type { ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface TemperatureControlProps {
  /** Change à chaque conversation ouverte : la valeur est portée par elle. */
  conversationId: string | null;
}

/**
 * Température de la conversation, dans la rangée du composeur.
 *
 * Elle était dans le panneau d'outillage, à droite, avec les réglages
 * « avancés ». C'était le mauvais endroit : la température n'est pas un
 * réglage d'atelier, c'est ce qui décide du ton du PROCHAIN message — même
 * famille que le mode de jeu et le modèle, donc même place.
 *
 * L'échantillonnage se change à chaud : contrairement aux paramètres de
 * lancement, il n'entre pas au manifest KV et n'invalide donc aucun état
 * sauvegardé. On peut le bouger en pleine conversation sans rien payer, et
 * c'est précisément ce qui justifie de le mettre à portée de main.
 */
export function TemperatureControl({ conversationId }: TemperatureControlProps) {
  const { t } = useTranslate();
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
      // Optimiste : le curseur doit suivre le doigt, pas l'aller-retour IPC.
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
        className={`temp-button${setting.overridden ? ' temp-button-set' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={`${t.temperature.label} — ${
          setting.overridden ? t.temperature.thisConversation : t.settings.inherited
        }`}
      >
        <span className="temp-glyph" aria-hidden="true">
          ◑
        </span>
        {value.toLocaleString()}
      </button>

      {open && (
        <div className="temp-menu popover" role="dialog" aria-label={t.temperature.label}>
          <p className="conv-menu-label">{t.temperature.label}</p>
          <input
            type="range"
            min={min}
            max={max}
            step={setting.step ?? 0.05}
            value={value}
            onChange={(e) => void change(Number(e.target.value))}
            aria-label={t.temperature.label}
          />
          <div className="temp-row">
            <span className="temp-value">{value.toLocaleString()}</span>
            {/* La provenance est dite : sans elle, on ne sait pas si on règle
                cette conversation ou si on lit le défaut global. */}
            <span className="temp-origin">
              {setting.overridden ? t.temperature.thisConversation : t.settings.inherited}
            </span>
            {setting.overridden && (
              <button type="button" className="temp-reset" onClick={() => void reset()}>
                {t.settings.reset}
              </button>
            )}
          </div>
          {setting.description && <p className="temp-help">{setting.description}</p>}
        </div>
      )}
    </span>
  );
}
