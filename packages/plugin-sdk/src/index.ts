/**
 * @aparte/bonaparte-plugin-sdk — ce qu'un auteur de plugin consomme.
 *
 * Principe directeur, emprunté aux noyaux de plugins qui tiennent la route :
 * **tout ce qu'un plugin enregistre passe par son contexte, et le contexte
 * défait tout à la désactivation**. Un auteur n'a aucune liste de
 * désinscriptions à tenir — donc rien à oublier. C'est la condition pour
 * qu'une vue (voire un outil) puisse être remplacée sans redémarrer l'app.
 */

import type { BonaparteBridge } from '@aparte/bonaparte-shared';

/**
 * Le pont exposé par le preload. Le déclarer ici évite à chaque plugin de
 * redéclarer le global — et garantit que tous parlent le MÊME contrat.
 */
declare global {
  interface Window {
    bonaparte: BonaparteBridge;
  }
}

export type {
  AgentToolContribution,
  PluginConfigField,
  PluginManifest,
  PluginStatusDto,
  ToolingViewContribution,
} from '@aparte/bonaparte-shared';

/** Résultat d'un outil, tel que le modèle le recevra. */
export interface PluginToolResult {
  ok: boolean;
  content: string;
}

export interface PluginToolInvocation {
  args: Record<string, unknown>;
  /** Racine du projet ouvert — absente si la conversation n'en a pas. */
  projectRoot?: string;
  signal: AbortSignal;
}

export type PluginToolHandler = (
  invocation: PluginToolInvocation,
) => Promise<PluginToolResult>;

/** Commande appelable depuis la vue du plugin. */
export type PluginCommandHandler = (payload: unknown) => Promise<unknown> | unknown;

/**
 * Contexte Node d'un plugin actif (main process). Tout enregistrement est
 * réversible : le hôte défait l'ensemble au `deactivate`.
 */
export interface PluginNodeContext {
  readonly pluginId: string;
  /**
   * Branche le handler d'un outil DÉCLARÉ dans le manifeste. Un outil non
   * déclaré est refusé : le manifeste reste la source de vérité, lisible
   * sans exécuter le plugin.
   */
  registerToolHandler(name: string, handler: PluginToolHandler): void;
  /**
   * Expose une commande à la VUE du plugin. C'est le seul chemin renderer →
   * moitié Node : il passe par l'hôte, donc il se démonte avec le plugin.
   */
  registerCommand(name: string, handler: PluginCommandHandler): void;
  /** Valeur d'un réglage du plugin (portée globale). */
  getConfig<T = unknown>(key: string): T | undefined;
  /**
   * Pousse un événement vers la VUE du plugin, sans qu'elle ait à interroger.
   *
   * Rend `false` quand la vue est en RETARD : l'appelant doit alors cesser de
   * lire sa source (mettre son PTY en pause, par exemple) jusqu'à ce que
   * `onDrain` se déclenche. Même convention que les flux Node — `write()` puis
   * `'drain'` — parce qu'elle est déjà connue.
   *
   * Sans cette contre-pression, un producteur rapide fait perdre des données :
   * c'est la leçon que VS Code a tirée pour son terminal.
   */
  emit(event: string, payload: unknown): boolean;
  /** La vue a rattrapé : le producteur peut reprendre. */
  onDrain(listener: () => void): void;
  /**
   * Canal vers UNE instance de vue — un onglet du panneau.
   *
   * Le panneau permet d'ouvrir plusieurs onglets du même type : deux
   * terminaux, trois navigateurs. La contre-pression est donc comptée par
   * instance, sinon un onglet qui déborde figerait ses voisins. Un plugin
   * multi-instances ouvre un canal par session et le garde à côté d'elle.
   */
  channel(instanceId: string): PluginInstanceChannel;
  /** Nettoyage supplémentaire à exécuter au démontage. */
  onDispose(dispose: () => void | Promise<void>): void;
  /** Journalise en préfixant par l'id du plugin. */
  log(message: string): void;
}

/** Point d'entrée Node d'un plugin : `export default definePlugin({...})`. */
/** Canal vers une instance de vue. Même contrat que `emit`/`onDrain`, ciblé. */
export interface PluginInstanceChannel {
  emit(event: string, payload: unknown): boolean;
  onDrain(listener: () => void): void;
  /** L'onglet est fermé : le compteur est oublié et le canal devient muet. */
  dispose(): void;
}

export interface PluginNodeModule {
  activate(context: PluginNodeContext): void | Promise<void>;
}

export function definePlugin(plugin: PluginNodeModule): PluginNodeModule {
  return plugin;
}

/**
 * Ce qu'une vue reçoit du panneau d'outillage. Le panneau ne fournit que
 * l'onglet et la place : la vue est souveraine sur son contenu.
 */
export interface ToolingViewProps {
  /** Projet de la conversation ouverte — absent si elle n'en a pas. */
  projectRoot: string | null;
  /** Conversation ouverte, pour les vues qui s'y rattachent. */
  conversationId: string | null;
  /**
   * Identité de CET onglet.
   *
   * Le panneau permettant d'ouvrir plusieurs onglets du même type, la vue ne
   * peut plus supposer qu'elle est seule : elle passe cet identifiant à chaque
   * commande, et ne retient que les événements qui le portent.
   */
  instanceId: string;
  locale: 'fr' | 'en';
}

export { SettingsForm } from './SettingsForm.js';
export type { SettingsFormLabels } from './SettingsForm.js';
