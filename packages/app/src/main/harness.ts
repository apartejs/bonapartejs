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
import {
  bonaparteDataDir,
  ChatSession,
  ConversationStore,
  createLlamaCppBackend,
  createSystemDoctorEnv,
  defaultScanRoots,
  detectServeCommandPrefix,
  fingerprintModelFile,
  KvStore,
  kvSlotsDir,
  scanModels,
  type Backend,
  type CompletionStats,
  type LiveBackendConfig,
  type ProcessHandle,
} from '@aparte/bonaparte-core';
import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type ConversationOpenReplyDto,
  type ModelInfoDto,
  type PickFileKind,
  type SetupSuggestionDto,
} from '@aparte/bonaparte-shared';
import { dialog, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';

/** Seules destinations externes autorisées depuis le renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

const DEFAULT_CONVERSATION = 'default';
const MANAGED_PORT = 8763;

// Prompt système v1 — figé par conversation (le contrat outillé arrive en J2).
const SYSTEM_PROMPT =
  'Tu es bonaparte, un agent de développement local-first. ' +
  'Réponds de façon précise et concise, en français par défaut.';

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
      child.kill();
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

export class Harness {
  private window: BrowserWindow | null = null;
  private engine: BackendConfigDto | null = null;
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

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  private emit(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  async loadConfig(): Promise<AppConfigDto> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as {
        backend?: BackendConfigDto & { modelPath?: string };
      };
      // Migration : les anciennes configs portaient modelPath dans le moteur.
      if (raw.backend && 'modelPath' in raw.backend) {
        delete raw.backend.modelPath;
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
    this.session = null;
  }

  /** Garantit un serveur managé chargé avec CE modèle (redémarre si besoin). */
  private async ensureManagedBackend(modelPath: string): Promise<void> {
    if (!this.engine || this.engine.mode !== 'managed') {
      throw new Error('Moteur managé non configuré.');
    }
    if (
      this.backend &&
      this.loadedModelPath === modelPath &&
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

    const nCtx = this.engine.nCtx ?? 8192;
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
    this.live = {
      modelFingerprint: await fingerprintModelFile(modelPath),
      nCtx,
      cacheTypeK: cacheType,
      cacheTypeV: cacheType,
      buildTag: await readBuildTag(this.engine.binPath),
    };
  }

  async openConversation(
    id: string = DEFAULT_CONVERSATION,
    modelPath?: string,
  ): Promise<ConversationOpenReplyDto> {
    if (!this.engine) throw new Error('Moteur non configuré.');

    // Résout le modèle de la conversation : méta épinglée > paramètre > à choisir.
    let convModel: string | undefined;
    if (await this.store.exists(id)) {
      const meta = await this.store.meta(id);
      convModel = meta.modelPath ?? modelPath;
      if (!meta.modelPath && modelPath) {
        await this.store.setModel(id, modelPath);
      }
    } else {
      convModel = modelPath;
    }

    if (this.engine.mode === 'managed') {
      if (!convModel) return { needsModel: true, conversationId: id };
      await this.ensureManagedBackend(convModel);
    } else if (!convModel) {
      // Distant : le modèle est celui du serveur — informatif.
      convModel = this.loadedModelPath ?? 'remote';
    }

    if (!this.backend || !this.live) throw new Error('Backend non démarré.');

    if (!(await this.store.exists(id))) {
      await this.store.create(id, { modelPath: convModel });
    }

    const { session, restore } = await ChatSession.open(
      {
        backend: this.backend,
        kv: this.kv,
        store: this.store,
        systemPrompt: SYSTEM_PROMPT,
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
      events: events.map((event) =>
        event.type === 'user'
          ? { type: 'user', text: event.text, at: event.at }
          : { type: 'assistant', text: stripThink(event.raw), at: event.at },
      ),
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
      // J1 : thinking désactivé (streaming propre) — toggle par tour en J2.
      for await (const event of this.session.send(text, { thinking: false })) {
        if (event.type === 'token') {
          this.emit(IPC.evAgent, {
            type: 'token',
            text: event.text,
          } satisfies AgentEventDto);
        } else {
          const stats: CompletionStats = event.stats;
          this.emit(IPC.evAgent, { type: 'done', stats } satisfies AgentEventDto);
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
    ipcMain.handle(IPC.conversationOpen, (_e, id?: string, modelPath?: string) =>
      this.openConversation(id, modelPath),
    );
    ipcMain.handle(IPC.agentSend, (_e, text: string) => this.send(text));
    ipcMain.handle(IPC.kvSave, () => this.saveKv());
    ipcMain.handle(IPC.setupSuggest, () => this.suggestSetup());
    ipcMain.handle(IPC.modelsScan, () => this.scanModelInventory());
    ipcMain.handle(IPC.dialogPickFile, (_e, kind: PickFileKind) =>
      this.pickFile(kind),
    );
    ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
      if (!EXTERNAL_URL_ALLOWLIST.some((re) => re.test(url))) {
        throw new Error(`URL externe refusée : ${url}`);
      }
      await shell.openExternal(url);
    });
  }
}
