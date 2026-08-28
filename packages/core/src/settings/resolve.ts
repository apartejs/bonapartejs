/**
 * Layered settings — a setting defined ONCE, rendered everywhere.
 *
 * The order is: built-in default → global → conversation. Two rules carry
 * everything else:
 *
 * - A setting declares the **scopes** where it can be changed. Launch
 *   parameters (context size, GPU layers, cache quantization…) go into
 *   the KV manifest: letting them vary per conversation would make the
 *   manifest diverge from the server actually launched, and the restore
 *   would be refused — or worse, wrongly accepted. So they are global,
 *   period.
 * - The resolution ALWAYS says where the value comes from, so the
 *   interface can write "inherited from the global setting" instead of
 *   showing a field whose origin the user has no idea about.
 */

import type { LocalizedText } from '@aparte/bonaparte-shared';

export type SettingScope = 'global' | 'conversation';
export type SettingsLayer = 'default' | SettingScope;

export interface SettingOption {
  value: string;
  /** Shown to the user: both locales, resolved where it is displayed. */
  label: LocalizedText;
}

export interface SettingField {
  key: string;
  /** Shown to the user: both locales, resolved where it is displayed. */
  label: LocalizedText;
  type: 'string' | 'number' | 'boolean' | 'select';
  /** Scopes where the setting is editable — at least one. */
  scopes: SettingScope[];
  default?: unknown;
  description?: LocalizedText;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Advanced setting: collapsed by default in the interface. */
  advanced?: boolean;
}

export interface SettingLayers {
  global?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
}

export interface ResolvedSetting {
  field: SettingField;
  key: string;
  value: unknown;
  /** Layer that provides the effective value. */
  from: SettingsLayer;
  /** Does the requested scope explicitly override this setting? */
  overridden: boolean;
  /** When not overridden: the layer the value is inherited from. */
  inheritedFrom?: SettingsLayer;
}

/**
 * Resolves the settings visible within a given scope.
 *
 * `scope` is the scope currently being edited: it filters the displayed
 * fields and determines what "overridden" means.
 */
export function resolveSettings(
  fields: SettingField[],
  layers: SettingLayers,
  scope: SettingScope,
): ResolvedSetting[] {
  return fields
    .filter((field) => field.scopes.includes(scope) || scope === 'global')
    .map((field) => {
      const chain: { layer: SettingsLayer; value: unknown }[] = [
        { layer: 'default', value: field.default },
      ];
      if (field.scopes.includes('global') && has(layers.global, field.key)) {
        chain.push({ layer: 'global', value: layers.global?.[field.key] });
      }
      // A conversation override on a setting that can't be set there is
      // ignored: better a setting that doesn't take than a server
      // launched with something other than what the manifest says.
      if (field.scopes.includes('conversation') && has(layers.conversation, field.key)) {
        chain.push({ layer: 'conversation', value: layers.conversation?.[field.key] });
      }

      const effective = [...chain].reverse().find((entry) => entry.value !== undefined) ?? {
        layer: 'default' as const,
        value: field.default,
      };
      const overridden = effective.layer === scope;

      return {
        field,
        key: field.key,
        value: effective.value,
        from: effective.layer,
        overridden,
        ...(overridden ? {} : { inheritedFrom: effective.layer }),
      };
    });
}

function has(source: Record<string, unknown> | undefined, key: string): boolean {
  return source !== undefined && key in source && source[key] !== undefined;
}
