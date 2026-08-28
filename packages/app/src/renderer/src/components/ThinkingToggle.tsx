import type { ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ThinkingToggleProps {
  /** Changes on every open conversation: the value is carried by it. */
  conversationId: string | null;
}

/**
 * Whether the model reasons before answering, in the composer's row —
 * next to the mode, the temperature and the model, because it conditions
 * the NEXT message the same way.
 *
 * It is a live choice: Qwen3 decides from the generation suffix of the
 * turn, the frozen history never changes, so toggling it invalidates no
 * saved state. Which is exactly why it can sit within reach instead of in
 * the settings hub.
 */
export function ThinkingToggle({ conversationId }: ThinkingToggleProps) {
  const { t } = useTranslate();
  const [setting, setSetting] = useState<ResolvedSettingDto | null>(null);

  const load = useCallback(async () => {
    const all = await window.bonaparte.getSettings('conversation');
    setSetting(all.find((entry) => entry.key === 'thinking') ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, conversationId]);

  const toggle = useCallback(async () => {
    const next = !(setting?.value !== false);
    // Optimistic: the switch answers the click, not the IPC round trip.
    setSetting((current) => (current ? { ...current, value: next, overridden: true } : current));
    await window.bonaparte.setSetting('conversation', 'thinking', next);
    await load();
  }, [load, setting]);

  if (!setting) return null;

  const on = setting.value !== false;
  return (
    <button
      type="button"
      className={`think-button aparte-btn aparte-btn--neutral aparte-btn--pill aparte-btn--sm ${
        on ? 'think-button-on aparte-btn--soft' : 'aparte-btn--ghost'
      }`}
      onClick={() => void toggle()}
      aria-pressed={on}
      title={`${t.thinking.label} ${on ? t.thinking.on : t.thinking.off} — ${t.thinking.hint}`}
    >
      <span className="think-glyph aparte-btn__icon" aria-hidden="true">
        {on ? '◐' : '○'}
      </span>
      {t.thinking.label}
    </button>
  );
}
