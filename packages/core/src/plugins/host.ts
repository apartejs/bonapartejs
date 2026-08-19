/**
 * Hôte de plugins — découverte, validation, activation RÉVERSIBLE.
 *
 * Deux principes, et le second est le seul qui compte à long terme :
 *
 * 1. Le manifeste est **déclaratif** : on le lit et on le valide sans exécuter
 *    une ligne du plugin. Un identifiant en double, une vue mal formée, un
 *    outil sans description se voient AVANT d'avoir chargé quoi que ce soit.
 *
 * 2. Tout ce qu'un plugin enregistre passe par son **contexte**, et le
 *    contexte défait tout au démontage. L'auteur d'un plugin n'a aucune liste
 *    de désinscriptions à tenir — donc rien à oublier. C'est ce qui rend une
 *    désactivation (ou un remplacement à chaud) sûre, plutôt que dépendante de
 *    la discipline de chacun.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  pluginManifestSchema,
  type PluginManifest,
  type PluginStatusDto,
} from '@aparte/bonaparte-shared';
import type { ToolDef, ToolHandler } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/** Résultat d'un outil de plugin, tel que le modèle le recevra. */
export interface PluginToolResult {
  ok: boolean;
  content: string;
}

export interface PluginToolInvocation {
  args: Record<string, unknown>;
  projectRoot?: string;
  signal: AbortSignal;
}

export type PluginToolHandler = (
  invocation: PluginToolInvocation,
) => Promise<PluginToolResult>;

export interface PluginNodeContext {
  readonly pluginId: string;
  registerToolHandler(name: string, handler: PluginToolHandler): void;
  getConfig<T = unknown>(key: string): T | undefined;
  onDispose(dispose: () => void | Promise<void>): void;
  log(message: string): void;
}

export interface PluginNodeModule {
  activate(context: PluginNodeContext): void | Promise<void>;
}

export interface DiscoveredPlugin {
  id: string;
  /** Dossier du plugin — sert à résoudre ses points d'entrée. */
  dir: string;
  manifest?: PluginManifest;
  error?: string;
  active: boolean;
}

export interface PluginHostOptions {
  registry: ToolRegistry;
  /** Réglages globaux des plugins, par id puis par clé. */
  config?: Record<string, Record<string, unknown>>;
  logger?: (message: string) => void;
}

/** Tout ce qu'une activation a posé, pour pouvoir le retirer d'un bloc. */
interface ActivationRecord {
  toolNames: string[];
  disposers: (() => void | Promise<void>)[];
}

export class PluginHost {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private readonly activations = new Map<string, ActivationRecord>();

  constructor(private readonly options: PluginHostOptions) {}

  /**
   * Scanne un dossier de plugins. Chaque sous-dossier contenant un
   * `plugin.json` est un candidat ; un manifeste illisible ou invalide est
   * RETENU avec son erreur, pour que le hub Réglages puisse le montrer au
   * lieu de le faire disparaître en silence.
   */
  async discover(root: string): Promise<DiscoveredPlugin[]> {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }

    const found: DiscoveredPlugin[] = [];
    for (const entry of entries.sort()) {
      const dir = join(root, entry);
      let raw: string;
      try {
        raw = await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8');
      } catch {
        continue; // pas un plugin : ni bruit, ni erreur
      }

      const parsed = this.parseManifest(raw);
      if ('error' in parsed) {
        found.push({ id: entry, dir, error: parsed.error, active: false });
        continue;
      }

      const manifest = parsed.manifest;
      const claimed = this.plugins.get(manifest.id);
      if (claimed && claimed.dir !== dir) {
        found.push({
          id: manifest.id,
          dir,
          error: `identifiant déjà pris par ${claimed.dir}`,
          active: false,
        });
        continue;
      }

      const plugin: DiscoveredPlugin = { id: manifest.id, dir, manifest, active: false };
      this.plugins.set(manifest.id, plugin);
      found.push(plugin);
    }
    return found;
  }

  private parseManifest(raw: string): { manifest: PluginManifest } | { error: string } {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { error: 'manifeste illisible (JSON invalide)' };
    }
    const result = pluginManifestSchema.safeParse(json);
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: first ? `${first.path.join('.') || 'manifeste'} : ${first.message}` : 'manifeste invalide',
      };
    }
    return { manifest: result.data };
  }

  /** Plugin découvert (utile pour résoudre le point d'entrée à importer). */
  get(id: string): DiscoveredPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Active un plugin déjà découvert. Le module est fourni par l'appelant :
   * c'est LUI qui décide comment charger du code (import() côté main,
   * protocole custom côté renderer) — l'hôte, lui, reste testable sans
   * charger quoi que ce soit.
   */
  async activate(id: string, module: PluginNodeModule): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin?.manifest) throw new Error(`Plugin inconnu : ${id}`);
    if (this.activations.has(id)) return;

    const manifest = plugin.manifest;
    const declared = new Map(manifest.contributes.agentTools.map((t) => [t.name, t]));
    const record: ActivationRecord = { toolNames: [], disposers: [] };

    const context: PluginNodeContext = {
      pluginId: id,
      registerToolHandler: (name, handler) => {
        const contribution = declared.get(name);
        if (!contribution) {
          throw new Error(
            `Outil non déclaré au manifeste de « ${id} » : ${name}. ` +
              'Le manifeste doit rester lisible sans exécuter le plugin.',
          );
        }
        const def: ToolDef = {
          name,
          description: contribution.description,
          inputSchema: { type: 'object', properties: {} },
          effect: contribution.effect,
        };
        this.options.registry.register(def, this.adapt(handler), 'plugin');
        record.toolNames.push(name);
      },
      getConfig: <T,>(key: string) =>
        this.options.config?.[id]?.[key] as T | undefined,
      onDispose: (dispose) => record.disposers.push(dispose),
      log: (message) => this.options.logger?.(`[plugin:${id}] ${message}`),
    };

    this.activations.set(id, record);
    try {
      await module.activate(context);
    } catch (error) {
      // Activation ratée = rien ne subsiste. Un plugin à moitié monté est
      // pire qu'un plugin absent : l'inventaire mentirait au modèle.
      await this.deactivate(id);
      plugin.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    plugin.active = true;
    delete plugin.error;
  }

  /** Démonte un plugin : outils retirés, nettoyages exécutés, dans l'ordre. */
  async deactivate(id: string): Promise<void> {
    const record = this.activations.get(id);
    if (!record) return;
    this.activations.delete(id);

    for (const name of record.toolNames) this.options.registry.unregister(name);
    // Les nettoyages tournent en ordre inverse d'inscription (pile), et l'un
    // qui échoue ne doit pas empêcher les suivants.
    for (const dispose of [...record.disposers].reverse()) {
      try {
        await dispose();
      } catch (error) {
        this.options.logger?.(
          `[plugin:${id}] nettoyage en échec : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const plugin = this.plugins.get(id);
    if (plugin) plugin.active = false;
  }

  /** Démonte tout — appelé à la fermeture de l'app. */
  async deactivateAll(): Promise<void> {
    for (const id of [...this.activations.keys()]) await this.deactivate(id);
  }

  /** Photo pour l'UI (hub Réglages, onglets du panneau d'outillage). */
  status(): PluginStatusDto[] {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest?.name ?? plugin.id,
      version: plugin.manifest?.version ?? '—',
      ...(plugin.manifest?.description ? { description: plugin.manifest.description } : {}),
      enabled: true,
      active: plugin.active,
      ...(plugin.error ? { error: plugin.error } : {}),
      views: plugin.active ? (plugin.manifest?.contributes.toolingViews ?? []) : [],
      toolNames: this.activations.get(plugin.id)?.toolNames ?? [],
    }));
  }

  /** Adapte la signature du SDK à celle du registre d'outils du harness. */
  private adapt(handler: PluginToolHandler): ToolHandler {
    return async (args, context) =>
      handler({
        args,
        ...(context.projectRoot ? { projectRoot: context.projectRoot } : {}),
        signal: context.signal,
      });
  }
}
