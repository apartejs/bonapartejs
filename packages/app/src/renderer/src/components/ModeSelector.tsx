import type { PlayModeDto } from '@aparte/bonaparte-shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { MENU_LABEL } from './menu-styles.js';

const MODES: PlayModeDto[] = ['lecture', 'repetition', 'plume', 'impro'];

/** The dot picks up the mode's tone: a glance is enough to know whether the agent has a free hand. */
const MODE_TONE: Record<PlayModeDto, string> = {
  lecture: 'text-muted-foreground',
  repetition: 'text-foreground',
  plume: 'text-primary',
  impro: 'text-destructive',
};

interface ModeSelectorProps {
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
}

/**
 * Play mode selector, mounted in the composer's toolbar.
 *
 * The mode decides what the agent is allowed to do ON THE NEXT MESSAGE: it
 * belongs to the act of sending, not to the dashboard — hence its place in
 * the composer's bottom row, no longer in the status bar.
 *
 * A native `<select>` can't display two lines per option, and a mode's name
 * alone doesn't say what it allows: "Improv" doesn't warn of anything. Hence
 * the menu — name, coloured dot, one line of description. It opens UPWARD:
 * the composer is at the bottom of the window.
 */
export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  const { t } = useTranslate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'mode-button h-7 rounded-full bg-muted px-2.5 text-xs font-normal',
            `mode-${mode}`,
            MODE_TONE[mode],
          )}
          title={t.modes.hint}
        >
          <span className="mode-dot size-[7px] shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span className="text-foreground">{t.modes[mode]}</span>
          <ChevronDown className="size-3 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="mode-menu w-[min(360px,calc(100vw-48px))]"
      >
        <DropdownMenuLabel className={MENU_LABEL}>{t.modes.hint}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => onModeChange(value as PlayModeDto)}>
          {MODES.map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className={cn('mode-option items-start py-1.5', value === mode && 'mode-option-active')}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn('mode-option-head flex items-center gap-1.5 text-[12.5px]', MODE_TONE[value])}>
                  <span className="mode-dot size-[7px] shrink-0 rounded-full bg-current" aria-hidden="true" />
                  <span className="text-foreground">{t.modes[value]}</span>
                </span>
                <span className="mode-option-desc text-[11.5px] leading-snug text-muted-foreground">
                  {t.modes.descriptions[value]}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
