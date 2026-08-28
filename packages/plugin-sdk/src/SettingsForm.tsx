import {
  localize,
  type BonaparteLocale,
  type ResolvedSettingDto,
  type SettingScopeDto,
} from '@aparte/bonaparte-shared';
import { useState } from 'react';

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
 */
export function SettingsForm({ settings, scope, labels, locale, onChange }: SettingsFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const visible = settings.filter((setting) => showAdvanced || !setting.advanced);
  const hasAdvanced = settings.some((setting) => setting.advanced);

  return (
    <div className="settings-form">
      {visible.map((setting) => (
        <div className="setting-row" key={setting.key}>
          <div className="setting-head">
            <label
              className="setting-label aparte-field-label"
              htmlFor={`set-${scope}-${setting.key}`}
            >
              {localize(setting.label, locale)}
            </label>
            {!setting.overridden && (
              <span className="setting-inherited aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm">
                {labels.inherited}
              </span>
            )}
            {setting.overridden && (
              <button
                type="button"
                className="setting-reset aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
                onClick={() => onChange(setting.key, undefined)}
              >
                {labels.reset}
              </button>
            )}
          </div>

          <Control setting={setting} scope={scope} locale={locale} onChange={onChange} />

          {setting.description && (
            <p className="setting-help aparte-field-hint">{localize(setting.description, locale)}</p>
          )}
          {setting.invalidatesKv && (
            <p className="setting-warning">{labels.kvWarning}</p>
          )}
        </div>
      ))}

      {hasAdvanced && (
        <button
          type="button"
          className="setting-advanced-toggle aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
          onClick={() => setShowAdvanced((shown) => !shown)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▾' : '▸'} {labels.advanced}
        </button>
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
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="aparte-switch"
        checked={setting.value === true}
        onChange={(event) => onChange(setting.key, event.target.checked)}
      />
    );
  }

  if (setting.type === 'select') {
    return (
      <select
        id={id}
        className="aparte-field aparte-field--sm"
        value={String(setting.value ?? '')}
        onChange={(event) => onChange(setting.key, event.target.value)}
      >
        {(setting.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {localize(option.label, locale)}
          </option>
        ))}
      </select>
    );
  }

  if (setting.type === 'number') {
    return (
      <input
        id={id}
        type="number"
        className="aparte-field aparte-field--sm"
        value={setting.value === undefined ? '' : String(setting.value)}
        {...(setting.min !== undefined ? { min: setting.min } : {})}
        {...(setting.max !== undefined ? { max: setting.max } : {})}
        {...(setting.step !== undefined ? { step: setting.step } : {})}
        onChange={(event) =>
          // An emptied field yields to inheritance rather than writing NaN.
          onChange(
            setting.key,
            event.target.value === '' ? undefined : Number(event.target.value),
          )
        }
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      className="aparte-field aparte-field--sm"
      value={String(setting.value ?? '')}
      onChange={(event) =>
        onChange(setting.key, event.target.value === '' ? undefined : event.target.value)
      }
    />
  );
}
