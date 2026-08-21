/**
 * Contrat de plugin — manifeste DÉCLARATIF (modèle `contributes` de VS Code).
 *
 * Le manifeste est lu et validé SANS exécuter la moindre ligne du plugin :
 * c'est ce qui permet d'afficher la liste des plugins, de détecter un conflit
 * d'identifiants ou une vue en double avant toute activation, et de refuser
 * proprement un plugin cassé au lieu de planter l'app à son chargement.
 */

import { z } from 'zod';

/** Identifiant : minuscules, chiffres et tirets — il sert de nom de dossier. */
const pluginId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'id : minuscules, chiffres et tirets, commençant par une lettre');

/**
 * Une vue montée dans le panneau d'outillage (à droite). Chaque vue est
 * souveraine sur son contenu : le panneau ne fournit que l'onglet et la place.
 */
export const toolingViewSchema = z.object({
  id: z.string().min(1).max(64),
  /** Titre d'onglet par défaut (l'i18n du plugin peut le remplacer). */
  title: z.string().min(1).max(48),
  /** Glyphe court affiché dans l'onglet — un caractère ou deux. */
  icon: z.string().max(4).optional(),
  /** Ordre indicatif dans le menu d'ouverture ; à défaut, ordre de découverte. */
  order: z.number().int().optional(),
  /**
   * Plusieurs instances simultanées autorisées.
   *
   * Deux terminaux ou deux pages ont un sens : ce sont deux sessions. Deux fois
   * les réglages de la conversation, non — le second n'aurait rien de plus à
   * montrer. Le défaut est donc `false` : une vue s'ouvre en un exemplaire tant
   * qu'elle n'a pas dit le contraire.
   */
  multiple: z.boolean().default(false),
  /** Accélérateur suggéré, affiché dans le menu d'ouverture (ex. « Ctrl+T »). */
  shortcut: z.string().max(24).optional(),
});

/** Un outil que le plugin ajoute à l'inventaire de l'agent. */
export const agentToolContributionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'nom d’outil : minuscules et underscores'),
  description: z.string().min(1).max(400),
  /** Effet dominant — pilote le moteur de permissions. */
  effect: z.enum(['read', 'write', 'execute']),
  /**
   * Schéma JSON des arguments. Il n'est PAS décoratif : la grammaire des
   * appels d'outils en est dérivée, donc un outil sans schéma est un outil
   * que le modèle ne peut appeler qu'avec un objet vide.
   */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

/** Un réglage exposé par le plugin dans le hub Réglages. */
export const configFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  /** Pour `select` uniquement. */
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  description: z.string().max(240).optional(),
  /**
   * Portées où le réglage est modifiable. Un réglage global-seul n'apparaît
   * pas dans les réglages d'une conversation, et réciproquement.
   */
  scopes: z.array(z.enum(['global', 'conversation'])).min(1),
});

export const pluginManifestSchema = z.object({
  id: pluginId,
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  description: z.string().max(240).optional(),
  /**
   * Points d'entrée. `node` tourne dans le main process (outils, backends) ;
   * `renderer` est importé paresseusement à l'affichage d'une vue.
   */
  entry: z
    .object({
      node: z.string().min(1).optional(),
      renderer: z.string().min(1).optional(),
    })
    .default({}),
  contributes: z
    .object({
      toolingViews: z.array(toolingViewSchema).default([]),
      agentTools: z.array(agentToolContributionSchema).default([]),
      configSchemas: z.array(configFieldSchema).default([]),
    })
    .default({ toolingViews: [], agentTools: [], configSchemas: [] }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type ToolingViewContribution = z.infer<typeof toolingViewSchema>;
export type AgentToolContribution = z.infer<typeof agentToolContributionSchema>;
export type PluginConfigField = z.infer<typeof configFieldSchema>;

/** État d'un plugin tel que l'UI le voit. */
export interface PluginStatusDto {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  active: boolean;
  /** Renseigné quand le manifeste est invalide ou l'activation a échoué. */
  error?: string;
  views: ToolingViewContribution[];
  toolNames: string[];
}
