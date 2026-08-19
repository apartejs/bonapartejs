/**
 * Réglages en couches — un réglage défini UNE fois, rendu partout.
 *
 * L'ordre est : défaut intégré → global → conversation. Deux règles portent
 * tout le reste :
 *
 * - Un réglage déclare les **portées** où il se modifie. Les paramètres de
 *   lancement (taille de contexte, couches GPU, quantification du cache…)
 *   entrent au manifest KV : les laisser varier par conversation ferait
 *   diverger le manifest du serveur réellement lancé, et le restore serait
 *   refusé — ou pire, accepté à tort. Ils sont donc globaux, point.
 * - La résolution dit TOUJOURS d'où vient la valeur, pour que l'interface
 *   puisse écrire « hérité du réglage global » au lieu d'afficher un champ
 *   dont l'utilisateur ignore l'origine.
 */

export type SettingScope = 'global' | 'conversation';
export type SettingsLayer = 'default' | SettingScope;

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  /** Portées où le réglage est modifiable — au moins une. */
  scopes: SettingScope[];
  default?: unknown;
  description?: string;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Réglage avancé : replié par défaut dans l'interface. */
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
  /** Couche qui fournit la valeur effective. */
  from: SettingsLayer;
  /** La portée demandée surcharge-t-elle explicitement ce réglage ? */
  overridden: boolean;
  /** Quand ce n'est pas surchargé : la couche dont la valeur est héritée. */
  inheritedFrom?: SettingsLayer;
}

/**
 * Résout les réglages visibles dans une portée donnée.
 *
 * `scope` est la portée qu'on est en train d'éditer : elle filtre les champs
 * affichés et détermine ce que « surchargé » veut dire.
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
      // Une surcharge de conversation sur un réglage qui ne s'y règle pas est
      // ignorée : mieux vaut un réglage qui ne prend pas qu'un serveur lancé
      // avec autre chose que ce que dit le manifest.
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
