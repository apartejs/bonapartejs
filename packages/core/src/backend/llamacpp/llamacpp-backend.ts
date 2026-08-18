/**
 * Backend llama.cpp — l'implémentation incluse d'office du contrat Backend.
 * Deux modes : 'managed' (bonaparte spawn/supervise llama-server, restart
 * borné) et 'remote' (llama-server déjà lancé ailleurs, ex. autre machine).
 *
 * Le spawn est injecté (SpawnFn) : la supervision se teste sans binaire réel,
 * contre le faux llama-server pour la partie HTTP.
 */

import type {
  Backend,
  BackendStatus,
  CompletionRequest,
  SlotApi,
} from '../types.js';
import { buildLlamaServerArgs, type LlamaCppLaunchConfig } from './args.js';
import { LlamaCppHttpClient } from './http-client.js';

export interface ProcessHandle {
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export type SpawnFn = (binPath: string, args: string[]) => ProcessHandle;

export interface ManagedOptions {
  mode: 'managed';
  binPath: string;
  launch: LlamaCppLaunchConfig;
  spawnFn: SpawnFn;
  /** Seam de test : URL du serveur si différente de 127.0.0.1:port. */
  baseUrl?: string;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  maxRestarts?: number;
  /**
   * Sous-commande à préfixer aux args — ['serve'] pour le CLI unifié
   * `llama`, [] pour le binaire historique `llama-server`.
   * Voir detectServeCommandPrefix().
   */
  commandPrefix?: string[];
}

export interface RemoteOptions {
  mode: 'remote';
  url: string;
  /**
   * Un serveur distant peut ne pas avoir --slot-save-path : l'utilisateur
   * le déclare. Les erreurs runtime restent propres si c'est faux.
   */
  assumeKvPersistence?: boolean;
}

export type LlamaCppBackendOptions = ManagedOptions | RemoteOptions;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function slotApi(client: LlamaCppHttpClient): SlotApi {
  return {
    save: (idSlot, filename) => client.saveSlot(idSlot, filename),
    restore: (idSlot, filename) => client.restoreSlot(idSlot, filename),
    erase: (idSlot) => client.eraseSlot(idSlot),
  };
}

abstract class BaseBackend implements Backend {
  abstract readonly id: string;
  readonly typeId = 'llamacpp';
  abstract readonly capabilities: Backend['capabilities'];
  slots?: SlotApi;

  protected currentStatus: BackendStatus = 'stopped';
  private readonly listeners = new Set<(status: BackendStatus) => void>();

  constructor(protected readonly client: LlamaCppHttpClient) {}

  status(): BackendStatus {
    return this.currentStatus;
  }

  protected setStatus(status: BackendStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  onStatusChange(listener: (status: BackendStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  complete(request: CompletionRequest) {
    return this.client.complete(request);
  }

  props() {
    return this.client.props();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}

class RemoteLlamaCppBackend extends BaseBackend {
  readonly id: string;
  readonly capabilities: Backend['capabilities'];

  constructor(options: RemoteOptions) {
    super(new LlamaCppHttpClient(options.url));
    this.id = `llamacpp:remote:${options.url}`;
    const kv = options.assumeKvPersistence ?? true;
    this.capabilities = { kvPersistence: kv, grammar: true };
    if (kv) this.slots = slotApi(this.client);
  }

  async start(): Promise<void> {
    this.setStatus('starting');
    if (await this.client.health()) {
      this.setStatus('ready');
      return;
    }
    this.setStatus('crashed');
    throw new Error(`llama-server distant injoignable : ${this.client.baseUrl}`);
  }

  async stop(): Promise<void> {
    // Distant : on ne tue rien, on se détache simplement.
    this.setStatus('stopped');
  }
}

class ManagedLlamaCppBackend extends BaseBackend {
  readonly id: string;
  readonly capabilities: Backend['capabilities'];

  private handle: ProcessHandle | null = null;
  private intentionalStop = false;
  private restartCount = 0;
  private readonly healthIntervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly maxRestarts: number;

  constructor(private readonly options: ManagedOptions) {
    super(
      new LlamaCppHttpClient(
        options.baseUrl ?? `http://127.0.0.1:${options.launch.port}`,
      ),
    );
    this.id = `llamacpp:managed:${options.launch.port}`;
    this.healthIntervalMs = options.healthIntervalMs ?? 500;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 120_000;
    this.maxRestarts = options.maxRestarts ?? 2;

    const kv = options.launch.slotSavePath !== undefined;
    this.capabilities = { kvPersistence: kv, grammar: true };
    if (kv) this.slots = slotApi(this.client);
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    this.restartCount = 0;
    await this.spawnAndWait('starting');
  }

  private async spawnAndWait(status: 'starting' | 'restarting'): Promise<void> {
    this.setStatus(status);

    const args = [
      ...(this.options.commandPrefix ?? []),
      ...buildLlamaServerArgs(this.options.launch),
    ];
    const handle = this.options.spawnFn(this.options.binPath, args);
    this.handle = handle;
    handle.onExit((code) => this.onProcessExit(handle, code));

    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.client.health()) {
        this.setStatus('ready');
        return;
      }
      await sleep(this.healthIntervalMs);
    }

    handle.kill();
    this.setStatus('crashed');
    throw new Error(
      `llama-server ne répond pas après ${this.healthTimeoutMs} ms (${this.client.baseUrl})`,
    );
  }

  private onProcessExit(handle: ProcessHandle, _code: number | null): void {
    if (this.handle !== handle) return; // process d'une vie antérieure
    this.handle = null;

    if (this.intentionalStop) {
      this.setStatus('stopped');
      return;
    }

    if (this.restartCount >= this.maxRestarts) {
      this.setStatus('crashed');
      return;
    }

    this.restartCount += 1;
    void this.spawnAndWait('restarting').catch(() => {
      // spawnAndWait a déjà posé le statut 'crashed'.
    });
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.handle?.kill();
    this.handle = null;
    this.setStatus('stopped');
  }
}

export function createLlamaCppBackend(options: LlamaCppBackendOptions): Backend {
  return options.mode === 'managed'
    ? new ManagedLlamaCppBackend(options)
    : new RemoteLlamaCppBackend(options);
}

export { buildLlamaServerArgs, LlamaCppHttpClient };
export { detectServeCommandPrefix } from './serve-command.js';
export type { LlamaCppLaunchConfig };
