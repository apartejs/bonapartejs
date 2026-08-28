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

/**
 * A setting is defined once and rendered everywhere — the global hub as much
 * as the conversation panel. Two things are never left unsaid:
 *
 * - **Where the value comes from.** A field that isn't overridden shows
 *   "inherited", with the button to revert to inheritance when it is one.
 *   Without that, the user can't tell whether they're looking at their own
 *   choice or a default.
 * - **What the change costs.** Settings that enter the KV manifest invalidate
 *   saved contexts: that's said BEFORE, not found out after.
 *
 * The class names without utilities (`setting-row`, `setting-help`…) are
 * hooks for tests and for a host's own rules; they carry no style.
 */
export function SettingsForm({ settings, scope, labels, locale, onChange }: SettingsFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const visible = settings.filter((setting) => showAdvanced || !setting.advanced);
  const hasAdvanced = settings.some((setting) => setting.advanced);

  return (
    <div className="settings-form flex max-w-[560px] flex-col gap-5">
      {visible.map((setting) => (
        <div className="setting-row flex flex-col gap-1.5" key={setting.key}>
          <div className="setting-head flex items-center gap-2">
            <Label htmlFor={`set-${scope}-${setting.key}`}>{localize(setting.label, locale)}</Label>
            {!setting.overridden && (
              <Badge
                variant="outline"
                className="setting-inherited border-dashed font-mono text-[10.5px] font-normal text-muted-foreground"
              >
                {labels.inherited}
              </Badge>
            )}
            {setting.overridden && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="setting-reset ms-auto h-auto p-0 text-xs"
                onClick={() => onChange(setting.key, undefined)}
              >
                {labels.reset}
              </Button>
            )}
          </div>

          <Control setting={setting} scope={scope} locale={locale} onChange={onChange} />

          {setting.description && (
            <p className="setting-help text-[11.5px] leading-snug text-muted-foreground">
              {localize(setting.description, locale)}
            </p>
          )}
          {setting.invalidatesKv && (
            <p className="setting-warning text-[11.5px] leading-snug text-destructive">{labels.kvWarning}</p>
          )}
        </div>
      ))}

      {hasAdvanced && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="setting-advanced-toggle self-start px-1 text-muted-foreground"
          onClick={() => setShowAdvanced((shown) => !shown)}
          aria-expanded={showAdvanced}
        >
          <ChevronRight className={cn('transition-transform', showAdvanced && 'rotate-90')} />
          {labels.advanced}
        </Button>
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
        <SelectTrigger id={id} size="sm" className="w-60 font-mono text-xs">
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
        className="h-8 max-w-60 font-mono text-xs"
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
      type="text"
      className="h-8 max-w-60 font-mono text-xs"
      value={String(setting.value ?? '')}
      onChange={(event) => onChange(setting.key, event.target.value === '' ? undefined : event.target.value)}
    />
  );
}
