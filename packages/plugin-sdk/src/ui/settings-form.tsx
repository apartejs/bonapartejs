import {
  localize,
  type BonaparteLocale,
  type ResolvedSettingDto,
  type SettingScopeDto,
} from '@aparte/bonaparte-shared';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils.js';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Label } from './label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';
import { Switch } from './switch.js';

/**
 * Labels provided by the host. The SDK stays agnostic of the app's i18n
 * provider: it knows only these four strings, plus the locale that resolves
 * the settings' own labels (which travel in both languages).
 */
export interface SettingsFormLabels {
  advanced: string;
  inherited: string;
  reset: string;
  kvWarning: string;
}

interface SettingsFormProps {
  settings: ResolvedSettingDto[];
  scope: SettingScopeDto;
  labels: SettingsFormLabels;
  locale: BonaparteLocale;
  onChange: (key: string, value: unknown) => void;
}

/** A field only shows when the settings it depends on hold one of the listed values (`showFor`). */
function isShown(setting: ResolvedSettingDto, all: ResolvedSettingDto[]): boolean {
  if (!setting.showFor) return true;
  return Object.entries(setting.showFor).every(([key, allowed]) => {
    const current = all.find((s) => s.key === key)?.value;
    return allowed.includes(String(current ?? ''));
  });
}

/**
 * A setting is defined once and rendered everywhere — the global hub as much
 * as the conversation panel. Every row is one line: the label on the start
 * edge, the control on the end, so a column of settings reads as a list
 * whatever their types are. Two things are never left unsaid:
 *
 * - **Where the value comes from.** A field that isn't overridden shows
 *   "inherited", with the button to revert to inheritance when it is one.
 * - **What the change costs.** Settings that enter the KV manifest invalidate
 *   saved contexts: that's said BEFORE, not found out after.
 *
 * A field can also depend on another (`showFor`) — the online search key only
 * appears once an online provider is chosen — and the advanced fields hide
 * behind a toggle, ABOVE the fields it reveals.
 *
 * The class names without utilities (`setting-row`, `setting-help`…) are
 * hooks for tests and for a host's own rules; they carry no style.
 */
export function SettingsForm({ settings, scope, labels, locale, onChange }: SettingsFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const shown = settings.filter((setting) => isShown(setting, settings));
  const ordinary = shown.filter((setting) => !setting.advanced);
  const advanced = shown.filter((setting) => setting.advanced);

  const row = (setting: ResolvedSettingDto) => (
    <div className="setting-row flex flex-col gap-1" key={setting.key}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Label htmlFor={`set-${scope}-${setting.key}`} className="truncate">
            {localize(setting.label, locale)}
          </Label>
          {!setting.overridden && (
            <Badge
              variant="outline"
              className="setting-inherited shrink-0 border-dashed font-mono text-[10.5px] font-normal text-muted-foreground"
            >
              {labels.inherited}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {setting.overridden && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="setting-reset h-auto p-0 text-xs"
              onClick={() => onChange(setting.key, undefined)}
            >
              {labels.reset}
            </Button>
          )}
          <Control setting={setting} scope={scope} locale={locale} onChange={onChange} />
        </div>
      </div>

      {setting.description && (
        <p className="setting-help text-[11.5px] leading-snug text-muted-foreground">
          {localize(setting.description, locale)}
        </p>
      )}
      {setting.invalidatesKv && (
        <p className="setting-warning text-[11.5px] leading-snug text-destructive">{labels.kvWarning}</p>
      )}
    </div>
  );

  return (
    <div className="settings-form flex max-w-[560px] flex-col gap-4">
      {ordinary.map(row)}

      {advanced.length > 0 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="setting-advanced-toggle -my-1 self-start px-1 text-muted-foreground"
            onClick={() => setShowAdvanced((open) => !open)}
            aria-expanded={showAdvanced}
          >
            <ChevronRight className={cn('transition-transform', showAdvanced && 'rotate-90')} />
            {labels.advanced}
          </Button>
          {showAdvanced && advanced.map(row)}
        </>
      )}
    </div>
  );
}

function Control({
  setting,
  scope,
  locale,
  onChange,
}: {
  setting: ResolvedSettingDto;
  scope: SettingScopeDto;
  locale: BonaparteLocale;
  onChange: (key: string, value: unknown) => void;
}) {
  const id = `set-${scope}-${setting.key}`;

  if (setting.type === 'boolean') {
    return (
      <Switch
        id={id}
        checked={setting.value === true}
        onCheckedChange={(checked) => onChange(setting.key, checked)}
      />
    );
  }

  if (setting.type === 'select') {
    return (
      <Select value={String(setting.value ?? '')} onValueChange={(value) => onChange(setting.key, value)}>
        <SelectTrigger id={id} size="sm" className="w-52 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(setting.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
              {localize(option.label, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (setting.type === 'number') {
    return (
      <Input
        id={id}
        type="number"
        className="h-8 w-28 font-mono text-xs"
        value={setting.value === undefined ? '' : String(setting.value)}
        {...(setting.min !== undefined ? { min: setting.min } : {})}
        {...(setting.max !== undefined ? { max: setting.max } : {})}
        {...(setting.step !== undefined ? { step: setting.step } : {})}
        onChange={(event) =>
          // An emptied field yields to inheritance rather than writing NaN.
          onChange(setting.key, event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    );
  }

  return (
    <Input
      id={id}
      type={setting.secret ? 'password' : 'text'}
      className="h-8 w-52 font-mono text-xs"
      value={String(setting.value ?? '')}
      onChange={(event) => onChange(setting.key, event.target.value === '' ? undefined : event.target.value)}
    />
  );
}
