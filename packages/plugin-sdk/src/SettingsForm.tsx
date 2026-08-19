import type { ResolvedSettingDto, SettingScopeDto } from '@aparte/bonaparte-shared';
import { useState } from 'react';

/**
 * Libellés fournis par l'hôte. Le SDK reste agnostique de l'i18n de l'app :
 * il ne connaît ni les locales, ni le provider — seulement ces cinq chaînes.
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
  onChange: (key: string, value: unknown) => void;
}

/**
 * Un réglage est défini une fois et rendu partout — hub global comme panneau
 * de conversation. Deux choses ne sont jamais tues :
 *
 * - **D'où vient la valeur.** Un champ non surchargé affiche « hérité », avec
 *   le bouton pour revenir à l'héritage quand il l'est. Sans ça, l'utilisateur
 *   ne sait pas s'il regarde son choix ou un défaut.
 * - **Ce que le changement coûte.** Les paramètres qui entrent au manifest KV
 *   invalident les contextes sauvegardés : c'est dit AVANT, pas constaté après.
 */
export function SettingsForm({ settings, scope, labels, onChange }: SettingsFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const visible = settings.filter((setting) => showAdvanced || !setting.advanced);
  const hasAdvanced = settings.some((setting) => setting.advanced);

  return (
    <div className="settings-form">
      {visible.map((setting) => (
        <div className="setting-row" key={setting.key}>
          <div className="setting-head">
            <label className="setting-label" htmlFor={`set-${scope}-${setting.key}`}>
              {setting.label}
            </label>
            {!setting.overridden && (
              <span className="setting-inherited">{labels.inherited}</span>
            )}
            {setting.overridden && (
              <button
                type="button"
                className="setting-reset"
                onClick={() => onChange(setting.key, undefined)}
              >
                {labels.reset}
              </button>
            )}
          </div>

          <Control setting={setting} scope={scope} onChange={onChange} />

          {setting.description && (
            <p className="setting-help">{setting.description}</p>
          )}
          {setting.invalidatesKv && (
            <p className="setting-warning">{labels.kvWarning}</p>
          )}
        </div>
      ))}

      {hasAdvanced && (
        <button
          type="button"
          className="setting-advanced-toggle"
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
  onChange,
}: {
  setting: ResolvedSettingDto;
  scope: SettingScopeDto;
  onChange: (key: string, value: unknown) => void;
}) {
  const id = `set-${scope}-${setting.key}`;

  if (setting.type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={setting.value === true}
        onChange={(event) => onChange(setting.key, event.target.checked)}
      />
    );
  }

  if (setting.type === 'select') {
    return (
      <select
        id={id}
        value={String(setting.value ?? '')}
        onChange={(event) => onChange(setting.key, event.target.value)}
      >
        {(setting.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
        value={setting.value === undefined ? '' : String(setting.value)}
        {...(setting.min !== undefined ? { min: setting.min } : {})}
        {...(setting.max !== undefined ? { max: setting.max } : {})}
        {...(setting.step !== undefined ? { step: setting.step } : {})}
        onChange={(event) =>
          // Un champ vidé rend l'héritage plutôt que d'écrire NaN.
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
      value={String(setting.value ?? '')}
      onChange={(event) =>
        onChange(setting.key, event.target.value === '' ? undefined : event.target.value)
      }
    />
  );
}
