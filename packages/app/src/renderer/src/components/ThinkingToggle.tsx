import type { ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { Toggle, cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { Brain } from 'lucide-react';
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
    <Toggle
      pressed={on}
      onPressedChange={() => void toggle()}
      variant="outline"
      size="sm"
      className={cn(
        'think-button h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground',
        'data-[state=on]:bg-muted data-[state=on]:text-foreground',
        on && 'think-button-on',
      )}
      title={`${t.thinking.label} ${on ? t.thinking.on : t.thinking.off} — ${t.thinking.hint}`}
    >
      <Brain className={cn('size-3.5', on ? 'opacity-90' : 'opacity-50')} aria-hidden="true" />
      {t.thinking.label}
    </Toggle>
  );
}
