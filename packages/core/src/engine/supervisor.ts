/**
 * EngineSupervisor — owns the ONE backend bonaparte talks to, and its life
 * cycle: the managed llama-server (spawned on demand, replaced when the
 * model changes, killed when an earlier session left it behind) or the
 * remote server the user pointed at.
 *
 * The launch parameters — context size, cache quantization, GPU layers —
 * belong to the ENGINE, not to the conversation (D-17): two conversations on
 * one model share one server, and a conversation only records the context
 * size of its saved state so the manifest can refuse a restore that would
 * not fit.
 *
 * Everything that reaches the operating system is injectable: the spawn,
 * the process probe, the fingerprint, the build tag. The specs run against
 * the fake server with none of it.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createLlamaCppBackend,
  detectServeCommandPrefix,
  type ProcessHandle,
  type SpawnFn,
} from '../backend/llamacpp/llamacpp-backend.js';
import type { Backend, BackendStatus } from '../backend/types.js';
import { fingerprintModelFile } from '../kv/fingerprint.js';
import type { LiveBackendConfig } from '../kv/kv-store.js';
import { readBuildTag } from './build-tag.js';
import { defaultProcessProbe, type ProcessProbe } from './process-probe.js';
import { createServerSpawner } from './spawn.js';

export type KvCacheType = 'f16' | 'q8_0' | 'q4_0';

/** What the user configured: a binary we launch, or a server we join. */
export type EngineConfig =
  | {
      mode: 'managed';
      binPath: string;
      /** Context size of the server — enters every KV manifest. */
      nCtx: number;
      cacheType?: KvCacheType;
      /** Absent = decided by llama.cpp from the available memory. */
      nGpuLayers?: number;
    }
  | { mode: 'remote'; url: string };

export interface LoadedModel {
  modelPath: string;
  nCtx: number;
}

export interface EngineSupervisorOptions {
  /** `--slot-save-path` of the managed server (KV states). */
  slotsDir: string;
  /** Trace of the spawned process, read at the next start to kill an orphan. */
  pidFile: string;
  spawnFn?: SpawnFn;
  /** Port of the managed server. */
  port?: number;
  /** Where to reach it — tests point this at the fake server. */
  baseUrl?: string;
  fingerprint?: (modelPath: string) => Promise<string>;
  buildTag?: (binPath: string) => Promise<string>;
  commandPrefix?: (binPath: string) => string[];
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  /**
   * Called while the previous server is still alive, before it is stopped
   * for another model: the caller saves the state it cares about (the open
   * conversation's KV state).
   */
  beforeUnload?: () => Promise<void>;
  processProbe?: ProcessProbe;
  logger?: (line: string) => void;
}

const DEFAULT_PORT = 8763;

export class EngineSupervisor {
  private config: EngineConfig | null = null;
  private current: Backend | null = null;
  private unsubscribe: (() => void) | null = null;
  private liveConfig: LiveBackendConfig | null = null;
  private loadedModel: LoadedModel | null = null;
  private readonly listeners = new Set<(status: BackendStatus) => void>();
  private readonly spawn: SpawnFn;
  private readonly probe: ProcessProbe;
  private readonly log: (line: string) => void;

  constructor(private readonly options: EngineSupervisorOptions) {
    this.log = options.logger ?? ((line) => console.log(line));
    this.spawn = options.spawnFn ?? createServerSpawner(this.log);
    this.probe = options.processProbe ?? defaultProcessProbe;
  }

  /** The backend in use, if one is running. */
  get backend(): Backend | null {
    return this.current;
  }

  /** What a KV manifest is checked against; null until a server serves. */
  get live(): LiveBackendConfig | null {
    return this.liveConfig;
  }

  get loaded(): LoadedModel | null {
    return this.loadedModel;
  }

  get engine(): EngineConfig | null {
    return this.config;
  }

  status(): BackendStatus {
    return this.current?.status() ?? 'stopped';
  }

  onStatusChange(listener: (status: BackendStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers the engine WITHOUT connecting to it: at startup bonaparte must
   * neither ping an endpoint (some servers load a model on the slightest
   * request) nor launch a server. A running server is torn down first: the
   * configuration that produced it no longer holds.
   */
  async configure(config: EngineConfig): Promise<void> {
    await this.teardown();
    this.config = config;
  }

  /** Remote engine: joins the server and reads what it serves. Managed: nothing to do without a model. */
  async connect(): Promise<BackendStatus> {
    if (!this.config) throw new Error('Engine not configured.');
    if (this.config.mode !== 'remote') return this.status();
    await this.teardown();

    const backend = createLlamaCppBackend({ mode: 'remote', url: this.config.url });
    this.adopt(backend);
    await backend.start();
    const props = await backend.props();
    const modelPath = props.modelPath || 'remote';
    this.loadedModel = { modelPath, nCtx: 0 };
    this.liveConfig = {
      modelFingerprint: `remote:${props.modelPath}`,
      nCtx: 0,
      cacheTypeK: 'f16',
      cacheTypeV: 'f16',
      buildTag: 'unknown',
    };
    return this.status();
  }

  /**
   * Guarantees a managed server serving THIS model with the engine's launch
   * parameters. Same model, server ready: nothing happens. Another model, or
   * a server that died: the caller gets to save first, the previous server
   * goes down, a new one comes up.
   */
  async ensureLoaded(modelPath: string): Promise<void> {
    if (!this.config) throw new Error('Engine not configured.');
    if (this.config.mode !== 'managed') return;
    const engine = this.config;

    if (
      this.current &&
      this.loadedModel?.modelPath === modelPath &&
      this.current.status() === 'ready'
    ) {
      return;
    }

    if (this.current) {
      await this.options.beforeUnload?.();
      await this.teardown();
    }

    const cacheType = engine.cacheType ?? 'f16';
    const backend = createLlamaCppBackend({
      mode: 'managed',
      binPath: engine.binPath,
      spawnFn: this.tracedSpawn,
      commandPrefix: (this.options.commandPrefix ?? detectServeCommandPrefix)(engine.binPath),
      launch: {
        modelPath,
        port: this.options.port ?? DEFAULT_PORT,
        nCtx: engine.nCtx,
        cacheTypeK: cacheType,
        cacheTypeV: cacheType,
        slotSavePath: this.options.slotsDir,
        parallelSlots: 1,
        ...(engine.nGpuLayers !== undefined ? { nGpuLayers: engine.nGpuLayers } : {}),
      },
      ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
      ...(this.options.healthIntervalMs !== undefined
        ? { healthIntervalMs: this.options.healthIntervalMs }
        : {}),
      ...(this.options.healthTimeoutMs !== undefined
        ? { healthTimeoutMs: this.options.healthTimeoutMs }
        : {}),
    });
    this.adopt(backend);

    await mkdir(this.options.slotsDir, { recursive: true });
    await backend.start();

    this.loadedModel = { modelPath, nCtx: engine.nCtx };
    this.liveConfig = {
      modelFingerprint: await (this.options.fingerprint ?? fingerprintModelFile)(modelPath),
      nCtx: engine.nCtx,
      cacheTypeK: cacheType,
      cacheTypeV: cacheType,
      buildTag: await (this.options.buildTag ?? readBuildTag)(engine.binPath),
    };
  }

  /** Stops the server (if any) and forgets what it served; the configuration stays. */
  async stop(): Promise<void> {
    await this.teardown();
  }

  /**
   * A server left behind by a session that died abruptly (crash, kill -9,
   * hot reload in development) keeps a model of several GB in memory with
   * nothing attached to it. The trace names it; the probe makes sure the pid
   * was not recycled by an unrelated process before killing it.
   */
  async killOrphan(): Promise<void> {
    let recorded: string;
    try {
      recorded = await readFile(this.options.pidFile, 'utf8');
    } catch {
      return;
    }
    await this.forgetPid();
    const pid = Number.parseInt(recorded.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0 || !this.probe.isLlama(pid)) return;
    this.log(`[llama-server] orphan detected (pid ${pid}) — stopping`);
    this.probe.kill(pid);
  }

  private adopt(backend: Backend): void {
    this.current = backend;
    this.unsubscribe = backend.onStatusChange((status) => {
      for (const listener of this.listeners) listener(status);
    });
  }

  private async teardown(): Promise<void> {
    const backend = this.current;
    if (backend) {
      // The 'stopped' the backend announces is part of the story listeners
      // follow: the subscription outlives the stop.
      await backend.stop().catch(() => undefined);
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = null;
    this.liveConfig = null;
    this.loadedModel = null;
  }

  /** The configured spawn, plus the pid trace written when the process starts and erased when it exits. */
  private readonly tracedSpawn: SpawnFn = (binPath, args) => {
    const handle = this.spawn(binPath, args);
    if (handle.pid !== undefined) void this.rememberPid(handle.pid);
    const traced: ProcessHandle = {
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      kill: () => handle.kill(),
      onExit: (cb) =>
        handle.onExit((code) => {
          void this.forgetPid();
          cb(code);
        }),
    };
    return traced;
  };

  private async rememberPid(pid: number): Promise<void> {
    try {
      await mkdir(dirname(this.options.pidFile), { recursive: true });
      await writeFile(this.options.pidFile, String(pid), 'utf8');
    } catch {
      /* the trace is a convenience, never a prerequisite */
    }
  }

  private async forgetPid(): Promise<void> {
    try {
      await rm(this.options.pidFile, { force: true });
    } catch {
      /* same */
    }
  }
}
