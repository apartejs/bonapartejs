/**
 * Pont entre @aparte/bonaparte-core et Electron : possède le MOTEUR (config
 * llama.cpp managé ou distant), la session de chat active et la config app.
 * Le modèle n'est pas un paramètre du moteur : chaque conversation épingle le
 * sien, et le serveur managé est (re)lancé avec le modèle de la conversation
 * active. Toute la logique métier vit dans core — ici, uniquement du câblage.
 */

import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  createOpenAiCompatBackend,
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
   * Projet de la conversation OUVERTE — pas de l'application. Miroir en
   * mémoire de `meta.projectRoot`, tenu à jour à chaque bascule.
   */
  private projectRoot: string | null = null;
  private currentConversationId: string | null = null;
  private readonly registry = new ToolRegistry();
  private readonly pluginHost = new PluginHost({
    registry: this.registry,
    logger: (message) => console.log(message),
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
  private readonly configPath = join(bonaparteDataDir(), 'config', 'global.json');

  /**
   * Les outils disque suivent le projet : sans projet, ils ne sont PAS dans
   * l'inventaire (donc inémettables), et en ouvrir un les annonce par un
   * delta d'inventaire dans les conversations en cours.
   */
  private syncToolsWithProject(): void {
    const registered = this.registry.list().length > 0;
    if (this.projectRoot && !registered) {
      for (const tool of builtinTools()) {
        this.registry.register(tool.def, tool.handler, 'builtin');
      }
    } else if (!this.projectRoot && registered) {
      for (const tool of builtinTools()) this.registry.unregister(tool.def.name);
    }
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /** Restaure projet et mode depuis la config au démarrage. */
  async restoreSession(): Promise<void> {
    // Avant tout : un serveur laissé par une session morte brutalement.
    await killOrphanedServer();
    await this.loadPlugins();
    const config = await this.loadConfig();
    // On rouvre la dernière conversation, et c'est ELLE qui dit s'il y a un
    // projet. Rien n'est chargé en VRAM ici : seulement de la méta.
    if (config.currentConversationId && (await this.store.exists(config.currentConversationId))) {
      this.currentConversationId = config.currentConversationId;
      this.projectRoot = (await this.store.meta(config.currentConversationId)).projectRoot ?? null;
    }
    this.syncToolsWithProject();
    if (config.mode) this.permissions.setMode(config.mode as PlayMode);
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
    this.projectRoot = (await this.store.meta(id)).projectRoot ?? null;
    this.syncToolsWithProject();
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
        ...(meta.projectRoot ? { projectName: basename(meta.projectRoot) } : {}),
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
              (await import(pathToFileURL(join(plugin.dir, nodeEntry)).href)) as {
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

  private project(recents: string[] = []): ProjectDto | null {
    if (!this.projectRoot) return null;
    return {
      root: this.projectRoot,
      name: basename(this.projectRoot),
      recents,
    };
  }

  async currentProject(): Promise<ProjectDto | null> {
    const config = await this.loadConfig();
    return this.project(config.recentProjects ?? []);
  }

  async openProject(): Promise<ProjectDto | null> {
    if (!this.window) return null;
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openDirectory'],
    });
    const picked = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!picked) return null;

    // Le dossier est attaché à la CONVERSATION ouverte, pas à l'application :
    // une autre conversation garde le sien, ou n'en a pas.
    const id = await this.ensureConversationId();
    await this.store.setProjectRoot(id, picked);
    this.projectRoot = picked;
    this.session = null;
    this.syncToolsWithProject();

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
    } else if (config.mode === 'openai-compat') {
      const backend = createOpenAiCompatBackend({
        baseUrl: config.baseUrl,
        model: config.model,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        label: 'endpoint OpenAI-compatible',
      });
      this.watchStatus(backend);
      await backend.start();
      this.backend = backend;
      this.loadedModelPath = config.model;
      // Pas de slots : le manifest n'aura jamais à être comparé.
      this.live = {
        modelFingerprint: `openai-compat:${config.baseUrl}:${config.model}`,
        nCtx: 0,
        cacheTypeK: 'n/a',
        cacheTypeV: 'n/a',
        buildTag: 'n/a',
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

    if (this.engine.mode === 'openai-compat') {
      // Le modèle est celui que sert l'endpoint : rien à choisir ici.
      convModel = this.engine.model;
    } else if (this.engine.mode === 'managed') {
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
        ...(this.projectRoot ? { projectRoot: this.projectRoot } : {}),
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
          if (event.type === 'assistant') {
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
  async conversationHistory(): Promise<ConversationOpenReplyDto> {
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
          if (event.type === 'assistant') {
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

  /** Découvre à quoi répond une URL (llama.cpp ou OpenAI-compatible). */
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
    ipcMain.handle(IPC.conversationHistory, () => this.conversationHistory());
    ipcMain.handle(IPC.conversationList, () => this.listConversations());
    ipcMain.handle(IPC.pluginsList, () => this.listPlugins());
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
