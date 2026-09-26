import { localize, type ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { Button, Popover, PopoverContent, PopoverTrigger, Slider, cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { Thermometer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { MENU_LABEL } from './menu-styles.js';

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

  const load = useCallback(async () => {
    const all = await window.bonaparte.getSettings('conversation');
    setSetting(all.find((entry) => entry.key === 'temperature') ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, conversationId]);

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
  const origin = setting.overridden ? t.temperature.thisConversation : t.settings.inherited;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Set FOR this conversation, the button stands apart from an
            inherited value: otherwise you can't tell a default from a choice. */}
        <Button
          type="button"
          variant={setting.overridden ? 'secondary' : 'ghost'}
          size="sm"
          className={cn(
            'temp-button h-7 gap-1.5 rounded-full px-2.5 font-mono text-[11.5px] font-normal tabular-nums',
            setting.overridden ? 'temp-button-set' : 'text-muted-foreground',
          )}
          title={`${t.temperature.label} — ${origin}`}
        >
          <Thermometer className="size-3.5 opacity-70" aria-hidden="true" />
          {value.toLocaleString(locale)}
        </Button>
      </PopoverTrigger>
      {/* Opens UPWARD: the composer is at the bottom of the window. */}
      <PopoverContent side="top" align="start" sideOffset={8} className="temp-menu w-64 p-3" aria-label={t.temperature.label}>
        <p className={cn(MENU_LABEL, 'mb-3')}>{t.temperature.label}</p>
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={setting.step ?? 0.05}
          onValueChange={([next]) => {
            if (next !== undefined) void change(next);
          }}
          aria-label={t.temperature.label}
          className="my-2"
        />
        <div className="temp-row mt-3 flex items-center gap-2">
          <span className="temp-value font-mono text-[13px] tabular-nums">{value.toLocaleString(locale)}</span>
          {/* The origin is stated: without it, you can't tell whether
              you're adjusting this conversation or reading the global
              default. */}
          <span className="temp-origin flex-1 text-[10.5px] text-muted-foreground">{origin}</span>
          {setting.overridden && (
            <Button type="button" variant="ghost" size="xs" className="temp-reset" onClick={() => void reset()}>
              {t.settings.reset}
            </Button>
          )}
        </div>
        {setting.description && (
          <p className="temp-help mt-2 text-[11.5px] leading-snug text-muted-foreground">
            {localize(setting.description, locale)}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
