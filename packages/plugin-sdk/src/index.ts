/**
 * @aparte/bonaparte-plugin-sdk — ce qu'un auteur de plugin consomme.
 *
 * Principe directeur, emprunté aux noyaux de plugins qui tiennent la route :
 * **tout ce qu'un plugin enregistre passe par son contexte, et le contexte
 * défait tout à la désactivation**. Un auteur n'a aucune liste de
 * désinscriptions à tenir — donc rien à oublier. C'est la condition pour
 * qu'une vue (voire un outil) puisse être remplacée sans redémarrer l'app.
 */

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
  /** Valeur d'un réglage du plugin (portée globale). */
  getConfig<T = unknown>(key: string): T | undefined;
  /** Nettoyage supplémentaire à exécuter au démontage. */
  onDispose(dispose: () => void | Promise<void>): void;
  /** Journalise en préfixant par l'id du plugin. */
  log(message: string): void;
}

/** Point d'entrée Node d'un plugin : `export default definePlugin({...})`. */
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
  locale: 'fr' | 'en';
}
