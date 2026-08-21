/**
 * Pont entre @aparte/bonaparte-core et Electron : possède le MOTEUR (config
 * llama.cpp managé ou distant), la session de chat active et la config app.
 * Le modèle n'est pas un paramètre du moteur : chaque conversation épingle le
 * sien, et le serveur managé est (re)lancé avec le modèle de la conversation
 * active. Toute la logique métier vit dans core — ici, uniquement du câblage.
 */

import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  bonaparteDataDir,
  builtinTools,
  ChatSession,
  ConversationStore,
  createLlamaCppBackend,
  createSystemDoctorEnv,
  defaultScanRoots,
  detectServeCommandPrefix,
  fingerprintModelFile,
  HARNESS_SETTINGS,
  KV_INVALIDATING_KEYS,
  KvStore,
  kvSlotsDir,
  PermissionEngine,
  PluginHost,
  ProjectStore,
  probeEndpoint,
  resolveSettings,
  SAMPLING_SETTINGS,
  scanModels,
  ToolRegistry,
  type Backend,
  type LiveBackendConfig,
  type PlayMode,
  type PluginNodeModule,
  type ProcessHandle,
  type SamplingParams,
  type SettingField,
  type SettingLayers,
} from '@aparte/bonaparte-core';
import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalResponseDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type ConversationEventDto,
  type ConversationSummaryDto,
  type ConversationOpenReplyDto,
  type EndpointProbeDto,
  type ModelInfoDto,
  type PickFileKind,
  type PlayModeDto,
  type PluginStatusDto,
  type ProjectDto,
  type ProjectSummaryDto,
  type ResolvedSettingDto,
  type SettingScopeDto,
  type SetupSuggestionDto,
} from '@aparte/bonaparte-shared';
import { app, dialog, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';

/** Seules destinations externes autorisées depuis le renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

const MANAGED_PORT = 8763;

// Le prompt système est désormais construit par ChatSession depuis
// l'inventaire d'outils, puis figé dans la conversation (J2).

const execFileAsync = promisify(execFile);

function realSpawn(binPath: string, args: string[]): ProcessHandle {
  const child = spawn(binPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    // POSIX : le serveur devient chef de son groupe, pour qu'on puisse
    // abattre tout l'arbre d'un coup (cf. kill).
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    console.log(`[llama-server] ${chunk.toString('utf8').trimEnd()}`);
  });
  void rememberSpawnedPid(child.pid);
  return {
    onExit: (cb) =>
      child.on('exit', (code) => {
        void forgetSpawnedPid();
        cb(code);
      }),
    kill: () => {
      // Windows : le CLI unifié `llama serve` est un lanceur qui spawne le
      // vrai serveur en enfant — child.kill() ne tuerait que le lanceur et
      // laisserait le modèle chargé en VRAM. taskkill /T abat tout l'arbre.
      //
      // SYNCHRONE volontairement : à la fermeture, un taskkill asynchrone
      // n'a pas le temps de démarrer avant qu'Electron ne quitte, et le
      // serveur survit à l'app (constaté : un llama-server orphelin de
      // 24 Go). Bloquer ~50 ms au shutdown est le prix de la certitude.
      if (process.platform === 'win32' && child.pid) {
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 5_000,
          });
        } catch {
          child.kill(); // dernier recours
        }
      } else {
        // POSIX : tuer le groupe de process, pas seulement le lanceur.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
          else child.kill();
        } catch {
          child.kill();
        }
      }
    },
  };
}

function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}

function modelDisplayName(modelPath: string): string {
  return basename(modelPath).replace(/\.gguf$/i, '');
}

/** Tag de build du binaire (ex. b10217-ddd4ec142) — 'unknown' en dernier recours. */
async function readBuildTag(binPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, ['--version'], {
      timeout: 5_000,
      windowsHide: true,
    });
    const line = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return line ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Trace du serveur managé en cours, pour le nettoyer au démarrage suivant si
 * l'app est morte sans arrêt propre (crash, kill -9, rechargement à chaud en
 * développement). Sinon un modèle de plusieurs Go reste en mémoire sans que
 * rien ne le rattache à quoi que ce soit.
 */
const PID_FILE = join(bonaparteDataDir(), 'managed-server.pid');

async function rememberSpawnedPid(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    await mkdir(dirname(PID_FILE), { recursive: true });
    await writeFile(PID_FILE, String(pid), 'utf8');
  } catch {
    /* la trace est un confort, jamais un prérequis */
  }
}

async function forgetSpawnedPid(): Promise<void> {
  try {
    await rm(PID_FILE, { force: true });
  } catch {
    /* idem */
  }
}

/** Le process existe-t-il encore ET est-ce bien un llama ? (garde anti-recyclage de PID) */
function isOrphanLlama(pid: number): boolean {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const listed = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5_000,
  });
  return /llama/i.test(listed.stdout ?? '');
}

/** Abat un serveur managé resté seul après une fin brutale de l'app. */
async function killOrphanedServer(): Promise<void> {
  let recorded: string;
  try {
    recorded = await readFile(PID_FILE, 'utf8');
  } catch {
    return;
  }
  const pid = Number.parseInt(recorded.trim(), 10);
  await forgetSpawnedPid();
  if (!Number.isInteger(pid) || pid <= 0 || !isOrphanLlama(pid)) return;

  console.log(`[llama-server] orphelin détecté (pid ${pid}) — arrêt`);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 5_000,
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* déjà parti */
      }
    }
  }
}

/**
 * Identifiant de conversation. Il ne dérive PLUS du projet : une conversation
 * existe pour elle-même, avec ou sans dossier, et on doit pouvoir en tenir
 * plusieurs sur le même projet. L'horodatage en tête garde les dossiers
 * lisibles et triés sur disque.
 */
function newConversationId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

export class Harness {
  private window: BrowserWindow | null = null;
  private engine: BackendConfigDto | null = null;
  /**
   * Périmètre de la conversation OUVERTE — pas de l'application.
   *
   * Les racines viennent du PROJET auquel la conversation est rattachée : un
   * seul endroit à éditer, un seul endroit pour les permissions. Vide est un
   * cas normal (conversation sans projet) : les outils marchent, sans
   * confinement.
   */
  private roots: string[] = [];
  private currentConversationId: string | null = null;
  private readonly registry = new ToolRegistry();
  private readonly pluginHost = new PluginHost({
    registry: this.registry,
    logger: (message) => console.log(message),
    // `core` ne connaît pas Electron : c'est ici qu'un événement de plugin
    // devient un message IPC vers la fenêtre.
    emit: (pluginId, event, payload) => {
      this.emit(IPC.evPlugin, { pluginId, event, payload });
    },
  });
  private readonly permissions = new PermissionEngine('repetition');
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (granted: boolean) => void;
      request: { tool: string; command?: string };
    }
  >();
  private backend: Backend | null = null;
  private live: LiveBackendConfig | null = null;
  /** Modèle actuellement chargé par le serveur managé. */
  private loadedModelPath: string | null = null;
  private session: ChatSession | null = null;
  private unsubscribeStatus: (() => void) | null = null;

  private readonly kv = new KvStore(kvSlotsDir());
  private readonly store = new ConversationStore(
    join(bonaparteDataDir(), 'conversations'),
  );
  private readonly projects = new ProjectStore(bonaparteDataDir());
  private readonly configPath = join(bonaparteDataDir(), 'config', 'global.json');

  /**
   * Les outils disque suivent le projet : sans projet, ils ne sont PAS dans
   * l'inventaire (donc inémettables), et en ouvrir un les annonce par un
   * delta d'inventaire dans les conversations en cours.
   */
  /**
   * Les outils intégrés sont TOUJOURS disponibles. Le projet est leur
   * périmètre — avec lui, les chemins y sont confinés ; sans lui, ils partent
   * du dossier personnel — mais il n'a jamais été leur condition d'existence.
   *
   * (L'ancienne version conditionnait l'enregistrement à « le registre est
   * vide », ce que les outils de plugins rendaient faux : les outils fichiers
   * ne s'enregistraient plus jamais, en silence.)
   */
  private registerBuiltinTools(): void {
    const present = new Set(this.registry.list().map((tool) => tool.name));
    for (const tool of builtinTools()) {
      if (!present.has(tool.def.name)) {
        this.registry.register(tool.def, tool.handler, 'builtin');
      }
    }
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /** Restaure projet et mode depuis la config au démarrage. */
  async restoreSession(): Promise<void> {
    // Avant tout : un serveur laissé par une session morte brutalement.
    await killOrphanedServer();
    await this.purgeLegacyConversations();
    await this.loadPlugins();
    const config = await this.loadConfig();
    // On rouvre la dernière conversation, et c'est ELLE qui dit s'il y a un
    // projet. Rien n'est chargé en VRAM ici : seulement de la méta.
    if (config.currentConversationId && (await this.store.exists(config.currentConversationId))) {
      this.currentConversationId = config.currentConversationId;
      this.roots = await this.rootsOf(config.currentConversationId);
    }
    this.registerBuiltinTools();
    if (config.mode) this.permissions.setMode(config.mode as PlayMode);
  }

  /**
   * Table rase des conversations d'ancienne forme (décision de Paul, 2026-08-20).
   *
   * Avant la refonte, une conversation portait son dossier elle-même
   * (`projectRoot`). Le périmètre appartient désormais au PROJET. Écrire du code
   * de compatibilité pour quelques conversations n'avait pas de sens : on les
   * supprime avec leur état KV, et on le DIT dans le journal plutôt que de les
   * faire disparaître en silence.
   *
   * La détection porte sur le JSON brut : le champ n'existe plus dans le type.
   */
  private async purgeLegacyConversations(): Promise<void> {
    const dir = join(bonaparteDataDir(), 'conversations');
    let ids: string[];
    try {
      ids = await readdir(dir);
    } catch {
      return;
    }
    for (const id of ids) {
      let raw: string;
      try {
        raw = await readFile(join(dir, id, 'meta.json'), 'utf8');
      } catch {
        continue;
      }
      if (!raw.includes('"projectRoot"')) continue;
      await this.store.remove(id);
      await this.kv.forget(id);
      console.log(`[conversations] ancienne forme purgée : ${id}`);
    }
  }

  /**
   * Racines en vigueur pour une conversation : celles de SON projet.
   *
   * Une conversation sans projet, ou dont le projet a été supprimé, rend un
   * périmètre vide — ce qui est un état licite, pas une erreur : les outils
   * marchent, simplement sans confinement.
   */
  private async rootsOf(conversationId: string): Promise<string[]> {
    const { projectId } = await this.store.meta(conversationId);
    if (!projectId) return [];
    return (await this.projects.get(projectId))?.roots ?? [];
  }

  /** Nom du projet pour l'affichage, ou rien s'il n'y en a pas. */
  private async projectNameOf(
    projectId: string | undefined,
  ): Promise<{ projectName?: string }> {
    if (!projectId) return {};
    const project = await this.projects.get(projectId);
    return project ? { projectName: project.name } : {};
  }

  /** Conversation courante, créée à la volée si l'app n'en a encore aucune. */
  private async ensureConversationId(): Promise<string> {
    if (this.currentConversationId) return this.currentConversationId;
    const metas = await this.store.listMeta();
    const id = metas[0]?.id ?? (await this.createConversation());
    await this.setCurrentConversation(id);
    return id;
  }

  private async setCurrentConversation(id: string): Promise<void> {
    this.currentConversationId = id;
    this.roots = await this.rootsOf(id);
    this.registerBuiltinTools();
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, currentConversationId: id });
  }

  async listConversations(): Promise<ConversationSummaryDto[]> {
    const metas = await this.store.listMeta();
    return Promise.all(
      metas.map(async (meta) => ({
        id: meta.id,
        title: meta.title,
        updatedAt: meta.updatedAt,
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        ...(await this.projectNameOf(meta.projectId)),
        ...(meta.modelPath ? { modelName: modelDisplayName(meta.modelPath) } : {}),
        // Une reprise instantanée se promet sur pièce : l'état doit exister.
        hasKvState: await this.kv.has(meta.id),
      })),
    );
  }

  async createConversation(projectRoot?: string): Promise<string> {
    const id = newConversationId();
    const defaults = (await this.loadConfig()).defaultModel;
    await this.store.create(id, {
      ...(projectRoot ? { projectRoot } : {}),
      ...(defaults?.path ? { modelPath: defaults.path } : {}),
      ...(defaults?.nCtx !== undefined ? { nCtx: defaults.nCtx } : {}),
    });
    return id;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.store.setTitle(id, title);
  }

  // ── Plugins ────────────────────────────────────────────────────────────

  /**
   * Dossier des plugins. En développement il vit à la racine du dépôt ; une
   * fois l'app empaquetée, dans les ressources.
   */
  private pluginsDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'plugins')
      : join(app.getAppPath(), '..', '..', 'plugins');
  }

  /**
   * Compteur de rechargement, utilisé comme cache-buster d'import ESM.
   *
   * `import()` mémoïse par URL : sans ce paramètre, réactiver un plugin
   * re-jouerait l'ANCIEN module même après recompilation. C'est le seul moyen
   * d'oublier un module ESM déjà chargé.
   */
  private pluginGeneration = 0;

  /**
   * Recharge les plugins À CHAUD : démontage complet puis re-découverte.
   *
   * C'est exactement ce pour quoi l'hôte a été rendu réversible — tout ce qu'un
   * plugin a enregistré part avec son contexte. Sans ça, retoucher la moitié
   * Node d'un plugin imposait de redémarrer l'app, donc de recharger le modèle
   * en VRAM : plusieurs dizaines de secondes pour trois lignes de plugin.
   */
  async reloadPlugins(): Promise<PluginStatusDto[]> {
    await this.pluginHost.deactivateAll();
    this.pluginGeneration += 1;
    await this.loadPlugins();
    // L'inventaire d'outils a pu changer : les conversations en cours
    // l'apprendront par un delta à leur prochaine ouverture.
    this.registerBuiltinTools();
    this.session = null;
    return this.listPlugins();
  }

  /**
   * Découvre puis active les plugins. Un plugin qui échoue est CONSERVÉ avec
   * son erreur — le hub Réglages doit pouvoir le montrer plutôt que de le
   * faire disparaître sans explication.
   */
  async loadPlugins(): Promise<void> {
    const found = await this.pluginHost.discover(this.pluginsDir());
    for (const plugin of found) {
      if (!plugin.manifest || plugin.error) continue;
      try {
        const nodeEntry = plugin.manifest.entry.node;
        const module: PluginNodeModule = nodeEntry
          ? ((
              (await import(
                `${pathToFileURL(join(plugin.dir, nodeEntry)).href}?v=${this.pluginGeneration}`,
              )) as {
                default: PluginNodeModule;
              }
            ).default)
          : { activate: () => undefined };
        await this.pluginHost.activate(plugin.id, module);
      } catch (error) {
        console.error(
          `[plugins] ${plugin.id} n'a pas pu être activé :`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  listPlugins(): PluginStatusDto[] {
    return this.pluginHost.status();
  }

  // ── Réglages ───────────────────────────────────────────────────────────

  /** Champs du harness plus ceux contribués par les plugins actifs. */
  private settingFields(): SettingField[] {
    const fromPlugins = this.pluginHost
      .status()
      .filter((plugin) => plugin.active)
      .flatMap(() => [] as SettingField[]);
    return [...HARNESS_SETTINGS, ...fromPlugins];
  }

  private async settingLayers(): Promise<SettingLayers> {
    const config = await this.loadConfig();
    const conversation = this.currentConversationId
      ? (await this.store.meta(this.currentConversationId).catch(() => null))?.settings
      : undefined;
    return {
      ...(config.settings ? { global: config.settings } : {}),
      ...(conversation ? { conversation } : {}),
    };
  }

  async getSettings(scope: SettingScopeDto): Promise<ResolvedSettingDto[]> {
    const resolved = resolveSettings(this.settingFields(), await this.settingLayers(), scope);
    return resolved.map((setting) => ({
      key: setting.key,
      label: setting.field.label,
      type: setting.field.type,
      ...(setting.field.description ? { description: setting.field.description } : {}),
      ...(setting.field.options ? { options: setting.field.options } : {}),
      ...(setting.field.min !== undefined ? { min: setting.field.min } : {}),
      ...(setting.field.max !== undefined ? { max: setting.field.max } : {}),
      ...(setting.field.step !== undefined ? { step: setting.field.step } : {}),
      ...(setting.field.advanced ? { advanced: true } : {}),
      value: setting.value,
      from: setting.from,
      overridden: setting.overridden,
      // L'interface doit prévenir AVANT le changement, pas constater après.
      invalidatesKv: KV_INVALIDATING_KEYS.has(setting.key),
    }));
  }

  async setSetting(scope: SettingScopeDto, key: string, value: unknown): Promise<void> {
    if (scope === 'conversation') {
      const id = this.currentConversationId;
      if (!id) return;
      await this.store.setSetting(id, key, value);
      // La session porte l'échantillonnage : elle sera rouverte au prochain
      // message avec les nouvelles valeurs.
      this.session = null;
      return;
    }
    const config = await this.loadConfig();
    const settings = { ...(config.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    await this.saveConfig({ ...config, settings });
    this.session = null;
  }

  /** Échantillonnage effectif de la conversation ouverte. */
  private async currentSampling(): Promise<SamplingParams> {
    const resolved = resolveSettings(
      SAMPLING_SETTINGS,
      await this.settingLayers(),
      'conversation',
    );
    const value = (key: string): number | undefined => {
      const found = resolved.find((setting) => setting.key === key)?.value;
      return typeof found === 'number' ? found : undefined;
    };
    const seed = value('seed');
    return {
      ...(value('temperature') !== undefined ? { temperature: value('temperature') } : {}),
      ...(value('topP') !== undefined ? { topP: value('topP') } : {}),
      ...(value('topK') !== undefined ? { topK: value('topK') } : {}),
      ...(value('minP') !== undefined ? { minP: value('minP') } : {}),
      // -1 = « aléatoire » : ne pas l'envoyer plutôt qu'envoyer une graine fixe.
      ...(seed !== undefined && seed >= 0 ? { seed } : {}),
    };
  }

  /**
   * Titre tiré du premier message, et de lui seul : renommer plus tard
   * écraserait un titre que l'utilisateur a pu choisir lui-même.
   */
  private async titleFromFirstMessage(text: string): Promise<void> {
    const id = this.currentConversationId;
    if (!id) return;
    try {
      const events = await this.store.loadEvents(id);
      if (events.some((event) => event.type === 'user')) return;
      const line = text.trim().replace(/\s+/g, ' ');
      if (!line) return;
      await this.store.setTitle(id, line.length > 60 ? `${line.slice(0, 57)}…` : line);
    } catch {
      /* un titre est un confort : jamais de quoi faire échouer un envoi */
    }
  }

  /**
   * Vue « projet » exposée au renderer.
   *
   * Intérimaire : le DTO ne porte encore qu'une racine, celle par défaut. Les
   * écrans qui montreront le projet complet — nom, N racines, édition — sont
   * l'étape 2, et c'est là que ce DTO deviendra un vrai projet.
   */
  private project(recents: string[] = []): ProjectDto | null {
    const primary = this.roots[0];
    if (!primary) return null;
    return {
      root: primary,
      name: basename(primary),
      recents,
    };
  }

  async currentProject(): Promise<ProjectDto | null> {
    const config = await this.loadConfig();
    return this.project(config.recentProjects ?? []);
  }

  // ── Projets ────────────────────────────────────────────────────────────

  async listProjects(): Promise<ProjectSummaryDto[]> {
    const projects = await this.projects.list();
    return projects.map(({ id, name, roots }) => ({ id, name, roots }));
  }

  async createProject(name: string, roots: string[] = []): Promise<ProjectSummaryDto> {
    const { id, roots: saved } = await this.projects.create({ name, roots });
    return { id, name, roots: saved };
  }

  async renameProject(id: string, name: string): Promise<ProjectSummaryDto> {
    const project = await this.projects.rename(id, name);
    await this.refreshRoots();
    return { id: project.id, name: project.name, roots: project.roots };
  }

  async setProjectRoots(id: string, roots: string[]): Promise<ProjectSummaryDto> {
    const project = await this.projects.setRoots(id, roots);
    // Le périmètre a bougé : la session en cours porte l'ancien, il faut la
    // reconstruire pour que le delta soit annoncé au modèle à la réouverture.
    await this.refreshRoots();
    return { id: project.id, name: project.name, roots: project.roots };
  }

  async removeProject(id: string): Promise<void> {
    // Les conversations du projet ne sont PAS supprimées : elles deviennent
    // « sans projet », donc sans confinement. Perdre un dossier ne doit jamais
    // perdre un historique.
    for (const meta of await this.store.listMeta()) {
      if (meta.projectId === id) await this.store.setProjectId(meta.id, undefined);
    }
    await this.projects.remove(id);
    await this.refreshRoots();
  }

  async setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): Promise<void> {
    await this.store.setProjectId(conversationId, projectId ?? undefined);
    await this.refreshRoots();
  }

  /** Sélecteur de dossier pur : aucun effet de bord, juste le chemin. */
  async pickDirectory(): Promise<string | null> {
    if (!this.window) return null;
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  /**
   * Recalcule le périmètre de la conversation ouverte et invalide la session.
   *
   * La session porte le périmètre avec lequel elle a été construite : la
   * laisser en place ferait travailler le modèle sur un décor périmé. La
   * reconstruire déclenche le delta au prochain envoi.
   */
  private async refreshRoots(): Promise<void> {
    if (!this.currentConversationId) return;
    this.roots = await this.rootsOf(this.currentConversationId);
    this.session = null;
    this.registerBuiltinTools();
  }

  async openProject(): Promise<ProjectDto | null> {
    if (!this.window) return null;
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openDirectory'],
    });
    const picked = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!picked) return null;

    // Le dossier appartient au PROJET, et la conversation appartient à un
    // projet. Choisir un dossier depuis une conversation sans projet en crée
    // donc un, nommé d'après le dossier ; depuis une conversation qui en a
    // déjà un, le dossier s'ajoute à ses racines.
    const id = await this.ensureConversationId();
    const { projectId } = await this.store.meta(id);

    if (projectId && (await this.projects.get(projectId))) {
      const project = await this.projects.get(projectId);
      const roots = project?.roots ?? [];
      if (!roots.includes(picked)) {
        await this.projects.setRoots(projectId, [...roots, picked]);
      }
    } else {
      const created = await this.projects.create({
        name: basename(picked),
        roots: [picked],
      });
      await this.store.setProjectId(id, created.id);
    }

    this.roots = await this.rootsOf(id);
    this.session = null;
    this.registerBuiltinTools();

    const config = await this.loadConfig();
    const recents = [picked, ...(config.recentProjects ?? []).filter((p) => p !== picked)]
      .slice(0, 8);
    await this.saveConfig({ ...config, recentProjects: recents });
    return this.project(recents);
  }

  getMode(): PlayModeDto {
    return this.permissions.getMode();
  }

  async setMode(mode: PlayModeDto): Promise<void> {
    this.permissions.setMode(mode as PlayMode);
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, mode });
  }

  /** Demande l'accord de l'utilisateur ; résolue par respondToApproval. */
  private readonly approve = (request: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    command?: string;
  }): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!this.window || this.window.isDestroyed()) {
        resolve(false); // pas d'interlocuteur : fail-safe
        return;
      }
      this.pendingApprovals.set(request.id, {
        resolve,
        request: {
          tool: request.tool,
          ...(request.command !== undefined ? { command: request.command } : {}),
        },
      });
      this.emit(IPC.evApproval, request);
    });

  async respondToApproval(response: ApprovalResponseDto): Promise<void> {
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);

    if (response.granted && response.always) {
      // « Toujours autoriser » : pour une commande, la règle porte sur son
      // premier mot (ex. « pnpm »), pas sur la ligne entière.
      const prefix = pending.request.command?.trim().split(/\s+/)[0];
      this.permissions.remember({
        tool: pending.request.tool,
        ...(prefix ? { commandPrefix: prefix } : {}),
      });
    }
    pending.resolve(response.granted);
  }

  private emit(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  async loadConfig(): Promise<AppConfigDto> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as {
        backend?: BackendConfigDto & { modelPath?: string; nCtx?: number };
      };
      // Migration : les anciennes configs portaient modelPath/nCtx dans le
      // moteur — ils appartiennent désormais à chaque conversation.
      if (raw.backend) {
        delete raw.backend.modelPath;
        delete raw.backend.nCtx;
      }
      return raw as AppConfigDto;
    } catch {
      return {};
    }
  }

  async saveConfig(config: AppConfigDto): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  status(): BackendStatusDto {
    return this.backend?.status() ?? 'stopped';
  }

  /**
   * Configure le moteur. Distant : connexion immédiate. Managé : le serveur
   * démarrera au premier openConversation (il lui faut un modèle).
   */
  /**
   * Enregistre le moteur SANS s'y connecter : au démarrage, bonaparte ne doit
   * ni pinger un endpoint (certains serveurs chargent le modèle à la moindre
   * requête), ni lancer un llama-server. Utiliser `connect()` pour l'activer.
   */
  async registerEngine(config: BackendConfigDto): Promise<void> {
    await this.teardownBackend();
    this.engine = config;
  }

  async startEngine(config: BackendConfigDto): Promise<BackendStatusDto> {
    await this.teardownBackend();
    this.engine = config;

    if (config.mode === 'remote') {
      const backend = createLlamaCppBackend({ mode: 'remote', url: config.url });
      this.watchStatus(backend);
      await backend.start();
      const props = await backend.props();
      this.backend = backend;
      this.loadedModelPath = props.modelPath || 'remote';
      this.live = {
        modelFingerprint: `remote:${props.modelPath}`,
        nCtx: 0,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        buildTag: 'unknown',
      };
    }

    return this.status();
  }

  private watchStatus(backend: Backend): void {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = backend.onStatusChange((status) =>
      this.emit(IPC.evBackendStatus, status),
    );
  }

  private async teardownBackend(): Promise<void> {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    if (this.backend) {
      await this.backend.stop().catch(() => undefined);
    }
    this.backend = null;
    this.live = null;
    this.loadedModelPath = null;
    this.loadedNCtx = null;
    this.session = null;
  }

  /** Modèle + nCtx actuellement servis par le serveur managé. */
  private loadedNCtx: number | null = null;

  /** Garantit un serveur managé chargé avec CE modèle et CE nCtx. */
  private async ensureManagedBackend(modelPath: string, nCtx: number): Promise<void> {
    if (!this.engine || this.engine.mode !== 'managed') {
      throw new Error('Moteur managé non configuré.');
    }
    if (
      this.backend &&
      this.loadedModelPath === modelPath &&
      this.loadedNCtx === nCtx &&
      this.backend.status() === 'ready'
    ) {
      return;
    }

    // Bascule de modèle : on sauvegarde l'état de la session courante avant.
    await this.saveKv();
    if (this.backend) {
      this.unsubscribeStatus?.();
      await this.backend.stop().catch(() => undefined);
      this.backend = null;
    }

    const cacheType = 'f16';
    const backend = createLlamaCppBackend({
      mode: 'managed',
      binPath: this.engine.binPath,
      spawnFn: realSpawn,
      // CLI unifié `llama` → sous-commande serve ; binaire historique → rien.
      commandPrefix: detectServeCommandPrefix(this.engine.binPath),
      launch: {
        modelPath,
        port: MANAGED_PORT,
        nCtx,
        cacheTypeK: cacheType,
        cacheTypeV: cacheType,
        slotSavePath: kvSlotsDir(),
        parallelSlots: 1,
        ...(this.engine.nGpuLayers !== undefined
          ? { nGpuLayers: this.engine.nGpuLayers }
          : {}),
      },
    });
    this.watchStatus(backend);

    await mkdir(kvSlotsDir(), { recursive: true });
    await backend.start();

    this.backend = backend;
    this.loadedModelPath = modelPath;
    this.loadedNCtx = nCtx;
    this.live = {
      modelFingerprint: await fingerprintModelFile(modelPath),
      nCtx,
      cacheTypeK: cacheType,
      cacheTypeV: cacheType,
      buildTag: await readBuildTag(this.engine.binPath),
    };
  }

  async openConversation(
    id?: string,
    modelPath?: string,
    nCtx?: number,
  ): Promise<ConversationOpenReplyDto> {
    if (!this.engine) throw new Error('Moteur non configuré.');
    id ??= await this.ensureConversationId();

    // Bascule : l'état de la conversation qu'on quitte doit être sauvegardé
    // AVANT d'en ouvrir une autre, sinon son cache est perdu et la reprise
    // coûtera un re-prefill complet — exactement ce qu'on prétend éviter.
    if (this.session && this.currentConversationId && this.currentConversationId !== id) {
      await this.session.save().catch(() => false);
      this.session = null;
    }
    if (await this.store.exists(id)) await this.setCurrentConversation(id);

    // Résout modèle + nCtx : méta épinglée > paramètres > défaut des Réglages.
    const defaults = (await this.loadConfig()).defaultModel;
    let convModel: string | undefined;
    let convNCtx: number | undefined;
    if (await this.store.exists(id)) {
      const meta = await this.store.meta(id);
      convModel = meta.modelPath ?? modelPath ?? defaults?.path;
      convNCtx = meta.nCtx ?? nCtx ?? defaults?.nCtx;
      if (!meta.modelPath && convModel) {
        await this.store.setModel(id, convModel, convNCtx);
      }
    } else {
      convModel = modelPath ?? defaults?.path;
      convNCtx = nCtx ?? defaults?.nCtx;
    }

    if (this.engine.mode === 'managed') {
      if (!convModel) return { needsModel: true, conversationId: id };
      await this.ensureManagedBackend(convModel, convNCtx ?? 8192);
    } else if (!convModel) {
      // Distant : le modèle est celui du serveur — informatif.
      convModel = this.loadedModelPath ?? 'remote';
    }

    if (!this.backend || !this.live) throw new Error('Backend non démarré.');

    if (!(await this.store.exists(id))) {
      await this.store.create(id, {
        modelPath: convModel,
        ...(convNCtx !== undefined ? { nCtx: convNCtx } : {}),
      });
    }

    const { session, restore } = await ChatSession.open(
      {
        backend: this.backend,
        kv: this.kv,
        store: this.store,
        registry: this.registry,
        permissions: this.permissions,
        ...(this.roots.length > 0 ? { roots: this.roots } : {}),
        approve: this.approve,
        // Le fil est anglais ; seule la langue de réponse suit l'utilisateur.
        replyLanguage: (await this.loadConfig()).locale === 'en' ? 'English' : 'French',
        sampling: await this.currentSampling(),
        live: this.live,
      },
      id,
    );
    this.session = session;

    const events = await this.store.loadEvents(id);
    return {
      conversationId: id,
      modelPath: convModel,
      modelName: modelDisplayName(convModel),
      ...(convNCtx !== undefined ? { nCtx: convNCtx } : {}),
      // Service et résultats d'outils restent hors de l'UI : ils vivent dans
      // le transcript, pas dans la conversation lue.
      events: events
        .flatMap((event): ConversationEventDto[] => {
          if (event.type === 'user') {
            return [{ type: 'user', text: event.text, at: event.at }];
          }
          // Une ligne de log abîmée saute, elle n'emporte pas l'ouverture
          // de la conversation avec elle.
          if (event.type === 'assistant' && event.entry) {
            return [
              {
                type: 'assistant',
                text: stripThink(event.entry.text),
                at: event.at,
              },
            ];
          }
          return [];
        })
        .filter((event) => event.text.trim() !== ''),
      restore: restore.restored
        ? { restored: true, nRestored: restore.nRestored }
        : { restored: false, reason: restore.reason },
    };
  }

  /**
   * Historique d'une conversation SANS toucher au moteur : lancer l'app ne
   * doit ni réveiller un serveur, ni charger un modèle en VRAM. La connexion
   * n'a lieu qu'au premier message.
   */
  async conversationHistory(select?: string): Promise<ConversationOpenReplyDto> {
    // Basculer de conversation est une opération de LECTURE : l'historique
    // vient du log sur disque, jamais du cache KV — celui-ci n'accélère que la
    // génération suivante. Consulter ses conversations ne doit donc charger
    // aucun modèle ni réveiller le moteur.
    if (select && select !== this.currentConversationId) {
      // L'état de celle qu'on quitte est sauvegardé si une session tournait :
      // sinon son cache serait perdu et y revenir coûterait un re-prefill.
      if (this.session) {
        await this.session.save().catch(() => false);
        this.session = null;
      }
      if (await this.store.exists(select)) await this.setCurrentConversation(select);
    }

    const id = this.currentConversationId;
    if (!id || !(await this.store.exists(id))) {
      return {
        conversationId: id ?? '',
        events: [],
        restore: { restored: false, reason: 'missing' },
      };
    }
    const meta = await this.store.meta(id);
    const events = await this.store.loadEvents(id);
    return {
      conversationId: id,
      ...(meta.modelPath
        ? { modelPath: meta.modelPath, modelName: modelDisplayName(meta.modelPath) }
        : {}),
      events: events
        .flatMap((event): ConversationEventDto[] => {
          if (event.type === 'user') {
            return [{ type: 'user', text: event.text, at: event.at }];
          }
          // Une ligne de log abîmée saute, elle n'emporte pas l'ouverture
          // de la conversation avec elle.
          if (event.type === 'assistant' && event.entry) {
            return [
              { type: 'assistant', text: stripThink(event.entry.text), at: event.at },
            ];
          }
          return [];
        })
        .filter((event) => event.text.trim() !== ''),
      restore: { restored: false, reason: 'not-connected' },
    };
  }

  async send(text: string): Promise<void> {
    // Connexion paresseuse : c'est le premier message qui réveille le moteur.
    if (!this.session && this.engine) {
      const reply = await this.openConversation();
      if ('needsModel' in reply) {
        this.emit(IPC.evAgent, {
          type: 'error',
          message: 'Aucun modèle choisi pour cette conversation.',
        } satisfies AgentEventDto);
        return;
      }
    }
    if (!this.session) {
      this.emit(IPC.evAgent, {
        type: 'error',
        message: 'Aucune conversation ouverte.',
      } satisfies AgentEventDto);
      return;
    }
    // Le premier message donne son titre à la conversation : un menu où tout
    // s'appelle « Nouvelle conversation » ne sert à rien.
    await this.titleFromFirstMessage(text);

    try {
      for await (const event of this.session.send(text)) {
        switch (event.type) {
          case 'token':
            this.emit(IPC.evAgent, {
              type: 'token',
              text: event.text,
            } satisfies AgentEventDto);
            break;
          case 'thinking':
            this.emit(IPC.evAgent, {
              type: 'thinking',
              text: event.text,
            } satisfies AgentEventDto);
            break;
          case 'tool_call':
            this.emit(IPC.evAgent, {
              type: 'tool_call',
              name: event.name,
              args: event.args,
            } satisfies AgentEventDto);
            break;
          case 'tool_result':
            this.emit(IPC.evAgent, {
              type: 'tool_result',
              name: event.name,
              ok: event.ok,
              content: event.content,
            } satisfies AgentEventDto);
            break;
          case 'turn_end':
            this.emit(IPC.evAgent, {
              type: 'done',
              stats: {
                promptMs: event.promptMs,
                promptUncachedTokens: 0,
                predictedTokens: 0,
                predictedMs: 0,
              },
            } satisfies AgentEventDto);
            break;
          case 'error':
            this.emit(IPC.evAgent, {
              type: 'error',
              message: event.message,
            } satisfies AgentEventDto);
            break;
          default:
            break; // mutations du log : persistées par la session
        }
      }
    } catch (error) {
      this.emit(IPC.evAgent, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies AgentEventDto);
    }
  }

  async saveKv(): Promise<boolean> {
    if (!this.session) return false;
    try {
      return await this.session.save();
    } catch (error) {
      console.error('[kv] sauvegarde échouée :', error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.saveKv();
    // Les plugins d'abord : ils tiennent des serveurs de dev, un shell, une
    // vue native. Tout ça doit tomber avec l'app, pas lui survivre.
    await this.pluginHost.deactivateAll().catch(() => undefined);
    await this.backend?.stop().catch(() => undefined);
  }

  async suggestSetup(): Promise<SetupSuggestionDto> {
    const env = createSystemDoctorEnv();
    const binPath =
      (await env.lookupOnPath('llama-server')) ??
      (await env.lookupOnPath('llama'));
    return binPath ? { binPath } : {};
  }

  async scanModelInventory(): Promise<ModelInfoDto[]> {
    return scanModels(defaultScanRoots());
  }

  /** Vérifie qu'un llama-server répond bien à cette URL (mode distant). */
  async probeEndpointUrl(url: string): Promise<EndpointProbeDto | null> {
    return probeEndpoint(url);
  }

  async pickFile(kind: PickFileKind): Promise<string | null> {
    if (!this.window) return null;
    const filters =
      kind === 'gguf'
        ? [
            { name: 'Modèle GGUF', extensions: ['gguf'] },
            { name: 'Tous les fichiers', extensions: ['*'] },
          ]
        : process.platform === 'win32'
          ? [
              { name: 'Exécutable', extensions: ['exe'] },
              { name: 'Tous les fichiers', extensions: ['*'] },
            ]
          : [{ name: 'Tous les fichiers', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openFile'],
      filters,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  registerIpc(ipcMain: IpcMain, appVersion: string): void {
    ipcMain.handle(IPC.appVersion, () => appVersion);
    ipcMain.handle(IPC.configGet, () => this.loadConfig());
    ipcMain.handle(IPC.configSet, (_e, config: AppConfigDto) =>
      this.saveConfig(config),
    );
    ipcMain.handle(IPC.backendStatus, () => this.status());
    ipcMain.handle(IPC.backendStart, (_e, config: BackendConfigDto) =>
      this.startEngine(config),
    );
    ipcMain.handle(IPC.backendRegister, (_e, config: BackendConfigDto) =>
      this.registerEngine(config),
    );
    ipcMain.handle(IPC.conversationHistory, (_e, select?: string) =>
      this.conversationHistory(select),
    );
    ipcMain.handle(IPC.conversationList, () => this.listConversations());
    ipcMain.handle(IPC.pluginsList, () => this.listPlugins());
    ipcMain.handle(IPC.pluginsReload, () => this.reloadPlugins());
    ipcMain.handle(IPC.pluginsAck, (_e, pluginId: string, bytes: number) => {
      this.pluginHost.acknowledge(pluginId, bytes);
    });
    ipcMain.handle(
      IPC.pluginsInvoke,
      (_e, pluginId: string, command: string, payload?: unknown) =>
        this.pluginHost.invoke(pluginId, command, payload),
    );
    ipcMain.handle(IPC.settingsGet, (_e, scope: SettingScopeDto) => this.getSettings(scope));
    ipcMain.handle(IPC.settingsSet, (_e, scope: SettingScopeDto, key: string, value: unknown) =>
      this.setSetting(scope, key, value),
    );
    ipcMain.handle(IPC.conversationCreate, (_e, projectRoot?: string) =>
      this.createConversation(projectRoot),
    );
    ipcMain.handle(IPC.conversationRename, (_e, id: string, title: string) =>
      this.renameConversation(id, title),
    );
    ipcMain.handle(
      IPC.conversationOpen,
      (_e, id?: string, modelPath?: string, nCtx?: number) =>
        this.openConversation(id, modelPath, nCtx),
    );
    ipcMain.handle(IPC.agentSend, (_e, text: string) => this.send(text));
    ipcMain.handle(IPC.kvSave, () => this.saveKv());
    ipcMain.handle(IPC.setupSuggest, () => this.suggestSetup());
    ipcMain.handle(IPC.modelsScan, () => this.scanModelInventory());
    ipcMain.handle(IPC.endpointProbe, (_e, url: string) => this.probeEndpointUrl(url));
    ipcMain.handle(IPC.dialogPickFile, (_e, kind: PickFileKind) =>
      this.pickFile(kind),
    );
    ipcMain.handle(IPC.projectOpen, () => this.openProject());
    ipcMain.handle(IPC.projectCurrent, () => this.currentProject());
    ipcMain.handle(IPC.projectsList, () => this.listProjects());
    ipcMain.handle(IPC.projectCreate, (_e, name: string, roots?: string[]) =>
      this.createProject(name, roots),
    );
    ipcMain.handle(IPC.projectRename, (_e, id: string, name: string) =>
      this.renameProject(id, name),
    );
    ipcMain.handle(IPC.projectSetRoots, (_e, id: string, roots: string[]) =>
      this.setProjectRoots(id, roots),
    );
    ipcMain.handle(IPC.projectRemove, (_e, id: string) => this.removeProject(id));
    ipcMain.handle(IPC.dialogPickDirectory, () => this.pickDirectory());
    ipcMain.handle(
      IPC.conversationSetProject,
      (_e, conversationId: string, projectId: string | null) =>
        this.setConversationProject(conversationId, projectId),
    );
    ipcMain.handle(IPC.modeGet, () => this.getMode());
    ipcMain.handle(IPC.modeSet, (_e, mode: PlayModeDto) => this.setMode(mode));
    ipcMain.handle(IPC.approvalRespond, (_e, response: ApprovalResponseDto) =>
      this.respondToApproval(response),
    );
    ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
      if (!EXTERNAL_URL_ALLOWLIST.some((re) => re.test(url))) {
        throw new Error(`URL externe refusée : ${url}`);
      }
      await shell.openExternal(url);
    });
  }
}
