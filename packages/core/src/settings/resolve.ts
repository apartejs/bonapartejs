/**
 * Layered settings — a setting defined ONCE, rendered everywhere.
 *
 * The order is: built-in default → global → project → conversation. Two
 * rules carry everything else:
 *
 * - A setting declares the **scopes** where it can be changed. Launch
 *   parameters (context size, GPU layers, cache types) go into the KV
 *   manifest: letting them vary per project or per conversation would make
 *   the manifest diverge from the server actually launched, and a restore
 *   would be refused — or worse, wrongly accepted. So they are global.
 * - The resolution ALWAYS says where the value comes from, so the window can
 *   write "inherited from the project" instead of showing a value whose
 *   origin nobody knows.
 *
 * Structure only: what the window shows of a setting (its name, its help)
 * lives in the window's language files.
 */

export type SettingScope = 'global' | 'project' | 'conversation';
export type SettingsLayer = 'default' | SettingScope;

export interface SettingField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'list';
  /** Scopes where the setting can be changed — at least one. */
  scopes: SettingScope[];
  default?: unknown;
  /** The values a select takes. */
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** A number that must be whole. */
  integer?: boolean;
  /** A number that also takes the word 'all' (the GPU layers). */
  allowAll?: boolean;
  /** Collapsed by default in the window. */
  advanced?: boolean;
  /** A secret (an API key): shown masked, and kept in the vault. */
  secret?: boolean;
  /** Changing it restarts the engine: the window announces it before. */
  requiresRestart?: boolean;
  /** Shown only when the listed sibling settings hold one of the given values. */
  showFor?: Record<string, string[]>;
}

export interface SettingLayers {
  global?: Record<string, unknown>;
  project?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
}

export interface ResolvedSetting {
  field: SettingField;
  key: string;
  value: unknown;
  /** The layer that provides the effective value. */
  from: SettingsLayer;
  /** Does the scope being edited override this setting itself? */
  overridden: boolean;
  /** When not overridden: the layer the value is inherited from. */
  inheritedFrom?: SettingsLayer;
}

const ORDER: SettingScope[] = ['global', 'project', 'conversation'];

/**
 * Resolves the settings visible within a scope. `scope` is the scope being
 * edited: it filters the fields shown, and says what "overridden" means.
 */
export function resolveSettings(fields: SettingField[], layers: SettingLayers, scope: SettingScope): ResolvedSetting[] {
  return fields
    .filter((field) => field.scopes.includes(scope))
    .map((field) => {
      let effective: { layer: SettingsLayer; value: unknown } = { layer: 'default', value: field.default };
      for (const layer of ORDER) {
        // An override from a scope the setting does not have is ignored:
        // better a setting that does not take than a server launched with
        // something other than what the manifest says.
        if (!field.scopes.includes(layer)) continue;
        const values = layers[layer];
        if (values !== undefined && values[field.key] !== undefined) {
          effective = { layer, value: values[field.key] };
        }
      }
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
