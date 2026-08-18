/**
 * Pont entre @aparte/bonaparte-core et Electron : possède le MOTEUR (config
 * llama.cpp managé ou distant), la session de chat active et la config app.
 * Le modèle n'est pas un paramètre du moteur : chaque conversation épingle le
 * sien, et le serveur managé est (re)lancé avec le modèle de la conversation
 * active. Toute la logique métier vit dans core — ici, uniquement du câblage.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
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
  KvStore,
  kvSlotsDir,
  PermissionEngine,
  scanModels,
  ToolRegistry,
  type Backend,
  type LiveBackendConfig,
  type PlayMode,
  type ProcessHandle,
} from '@aparte/bonaparte-core';
import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalResponseDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type ConversationEventDto,
  type ConversationOpenReplyDto,
  type ModelInfoDto,
  type PickFileKind,
  type PlayModeDto,
  type ProjectDto,
  type SetupSuggestionDto,
} from '@aparte/bonaparte-shared';
import { dialog, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';

/** Seules destinations externes autorisées depuis le renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

const DEFAULT_CONVERSATION = 'default';
const MANAGED_PORT = 8763;

// Le prompt système est désormais construit par ChatSession depuis
// l'inventaire d'outils, puis figé dans la conversation (J2).

const execFileAsync = promisify(execFile);

function realSpawn(binPath: string, args: string[]): ProcessHandle {
  const child = spawn(binPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    console.log(`[llama-server] ${chunk.toString('utf8').trimEnd()}`);
  });
  return {
    onExit: (cb) => child.on('exit', (code) => cb(code)),
    kill: () => {
      // Windows : le CLI unifié `llama serve` est un lanceur qui spawne le
      // vrai serveur en enfant — child.kill() ne tuerait que le lanceur et
      // laisserait le modèle chargé en VRAM. taskkill /T abat tout l'arbre.
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        });
      } else {
        child.kill();
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

/** Identifiant de conversation propre au projet (les slots KV sont globaux). */
function conversationIdFor(projectRoot: string, name = 'default'): string {
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
  return `${hash}-${name}`;
}

export class Harness {
  private window: BrowserWindow | null = null;
  private engine: BackendConfigDto | null = null;
  private projectRoot: string | null = null;
  private readonly registry = new ToolRegistry();
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

  constructor() {
    for (const tool of builtinTools()) {
      this.registry.register(tool.def, tool.handler, 'builtin');
    }
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /** Restaure projet et mode depuis la config au démarrage. */
  async restoreSession(): Promise<void> {
    const config = await this.loadConfig();
    if (config.projectRoot) this.projectRoot = config.projectRoot;
    if (config.mode) this.permissions.setMode(config.mode as PlayMode);
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

    this.projectRoot = picked;
    this.session = null;

    const config = await this.loadConfig();
    const recents = [picked, ...(config.recentProjects ?? []).filter((p) => p !== picked)]
      .slice(0, 8);
    await this.saveConfig({ ...config, projectRoot: picked, recentProjects: recents });
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
    // Un agent de code travaille sur un dossier : pas de projet, pas de tour.
    if (!this.projectRoot) return { needsProject: true };
    id ??= conversationIdFor(this.projectRoot, DEFAULT_CONVERSATION);

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
        projectRoot: this.projectRoot,
        approve: this.approve,
        // Le fil est anglais ; seule la langue de réponse suit l'utilisateur.
        replyLanguage: (await this.loadConfig()).locale === 'en' ? 'English' : 'French',
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

  async send(text: string): Promise<void> {
    if (!this.session) {
      this.emit(IPC.evAgent, {
        type: 'error',
        message: 'Aucune conversation ouverte.',
      } satisfies AgentEventDto);
      return;
    }
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
    ipcMain.handle(
      IPC.conversationOpen,
      (_e, id?: string, modelPath?: string, nCtx?: number) =>
        this.openConversation(id, modelPath, nCtx),
    );
    ipcMain.handle(IPC.agentSend, (_e, text: string) => this.send(text));
    ipcMain.handle(IPC.kvSave, () => this.saveKv());
    ipcMain.handle(IPC.setupSuggest, () => this.suggestSetup());
    ipcMain.handle(IPC.modelsScan, () => this.scanModelInventory());
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
