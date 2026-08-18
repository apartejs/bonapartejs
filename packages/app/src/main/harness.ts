/**
 * Pont entre @aparte/bonaparte-core et Electron : possède le backend, la
 * session de chat active et la config, et expose le tout via l'IPC typé.
 * Toute la logique métier vit dans core — ici, uniquement du câblage.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  bonaparteDataDir,
  ChatSession,
  ConversationStore,
  createLlamaCppBackend,
  fingerprintModelFile,
  KvStore,
  kvSlotsDir,
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
  type ConversationOpenResultDto,
} from '@aparte/bonaparte-shared';
import type { BrowserWindow, IpcMain } from 'electron';

const DEFAULT_CONVERSATION = 'default';

// Prompt système v1 — figé par conversation (le contrat outillé arrive en J2).
const SYSTEM_PROMPT =
  'Tu es bonaparte, un agent de développement local-first. ' +
  'Réponds de façon précise et concise, en français par défaut.';

function realSpawn(binPath: string, args: string[]): ProcessHandle {
  const child = spawn(binPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
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

export class Harness {
  private window: BrowserWindow | null = null;
  private backend: Backend | null = null;
  private live: LiveBackendConfig | null = null;
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
      return JSON.parse(await readFile(this.configPath, 'utf8')) as AppConfigDto;
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

  async startBackend(config: BackendConfigDto): Promise<BackendStatusDto> {
    if (this.backend) {
      this.unsubscribeStatus?.();
      await this.backend.stop().catch(() => undefined);
      this.backend = null;
      this.session = null;
    }

    let backend: Backend;
    let live: LiveBackendConfig;

    if (config.mode === 'managed') {
      const nCtx = config.nCtx ?? 8192;
      const cacheType = 'f16';
      backend = createLlamaCppBackend({
        mode: 'managed',
        binPath: config.binPath,
        spawnFn: realSpawn,
        launch: {
          modelPath: config.modelPath,
          port: 8763,
          nCtx,
          cacheTypeK: cacheType,
          cacheTypeV: cacheType,
          slotSavePath: kvSlotsDir(),
          parallelSlots: 1,
          ...(config.nGpuLayers !== undefined
            ? { nGpuLayers: config.nGpuLayers }
            : {}),
        },
      });
      live = {
        modelFingerprint: await fingerprintModelFile(config.modelPath),
        nCtx,
        cacheTypeK: cacheType,
        cacheTypeV: cacheType,
        // v1 : le tag de build du binaire managé sera fourni par le
        // téléchargeur (J5) ; 'unknown' ne matche que 'unknown'.
        buildTag: 'unknown',
      };
    } else {
      backend = createLlamaCppBackend({ mode: 'remote', url: config.url });
      live = {
        modelFingerprint: 'remote:pending',
        nCtx: 0,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        buildTag: 'unknown',
      };
    }

    this.unsubscribeStatus = backend.onStatusChange((status) =>
      this.emit(IPC.evBackendStatus, status),
    );

    await mkdir(kvSlotsDir(), { recursive: true });
    await backend.start();

    if (config.mode === 'remote') {
      // Identité du modèle distant : le chemin rapporté par /props.
      const props = await backend.props();
      live = { ...live, modelFingerprint: `remote:${props.modelPath}` };
    }

    this.backend = backend;
    this.live = live;
    return backend.status();
  }

  async openConversation(id: string): Promise<ConversationOpenResultDto> {
    if (!this.backend || !this.live) {
      throw new Error('Backend non démarré.');
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

  registerIpc(ipcMain: IpcMain, appVersion: string): void {
    ipcMain.handle(IPC.appVersion, () => appVersion);
    ipcMain.handle(IPC.configGet, () => this.loadConfig());
    ipcMain.handle(IPC.configSet, (_e, config: AppConfigDto) =>
      this.saveConfig(config),
    );
    ipcMain.handle(IPC.backendStatus, () => this.status());
    ipcMain.handle(IPC.backendStart, (_e, config: BackendConfigDto) =>
      this.startBackend(config),
    );
    ipcMain.handle(IPC.conversationOpen, (_e, id?: string) =>
      this.openConversation(id ?? DEFAULT_CONVERSATION),
    );
    ipcMain.handle(IPC.agentSend, (_e, text: string) => this.send(text));
    ipcMain.handle(IPC.kvSave, () => this.saveKv());
  }
}
