/**
 * EngineSupervisor — owns the ONE engine bonaparte talks to and its life
 * cycle: the managed llama-server (launched on demand, replaced when the
 * model changes, unloaded after a while without work, killed when an earlier
 * session left it behind) or the remote server the person pointed at.
 *
 * The launch parameters — context size, cache types, GPU layers, slots —
 * belong to the ENGINE, not to the conversation: two conversations on one
 * model share one server, and a conversation only records the context of
 * its saved state, for the KV manifest.
 *
 * At startup it neither pings an endpoint (some servers load a model on the
 * slightest request) nor launches a server: configuring costs nothing.
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { detectServeCommandPrefix } from '../backend/llamacpp/serve-command.js';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { ManagedServer } from '../backend/llamacpp/managed-server.js';
import type { BackendStatus } from '../backend/types.js';
import { writeJsonFile } from '../fs/json-file.js';
import { fingerprintModelFile } from '../kv/fingerprint.js';
import type { SpawnFn } from '../process/spawn.js';
import { MeasureStore } from './measures.js';
import { defaultProcessProbe, readBuildTag, type ProcessProbe } from './process-probe.js';
import { assertLlamaBinary } from './validate.js';

export type KvCacheType = 'f16' | 'q8_0' | 'q4_0';

/** What the person configured: a binary we launch, or a server we join. */
export type EngineConfig =
  | {
      mode: 'managed';
      binPath: string;
      /** The context of each slot — what each conversation gets. */
      nCtx: number;
      cacheType?: KvCacheType;
      /** Absent or 'all': every layer on the graphics card. */
      gpuLayers?: number | 'all';
      /** Absent: one. Each slot is a whole context more in video memory. */
      slots?: number;
    }
  | { mode: 'remote'; url: string };

export interface LoadedModel {
  modelPath: string;
  /** The context one slot really has. */
  nCtx: number;
}

/** What a KV manifest is checked against. */
export interface LiveEngine {
  modelFingerprint: string;
  nCtx: number;
  cacheTypeK: KvCacheType;
  cacheTypeV: KvCacheType;
  buildTag: string;
}

export interface EngineSupervisorOptions {
  /** `--slot-save-path` of the managed server (the KV states). */
  slotsDir: string;
  /** The trace of the launched server, read at the next start to kill an orphan. */
  pidFile: string;
  /** What this machine measured, kept across launches (default: for this process only). */
  measures?: MeasureStore;
  /** The port of the managed server (default 8763). */
  port?: number;
  /**
   * Tests only: what to launch instead of llama.cpp, as a program and its
   * first arguments (`[node, fake-llama-bin.mjs]`). The configured binary
   * is then neither checked nor run.
   */
  llamaCommand?: readonly string[];
  fingerprint?: (modelPath: string) => Promise<string>;
  processProbe?: ProcessProbe;
  /**
   * Called while the server still serves, before it is stopped (for another
   * model, or after a while without work): the caller saves what it cares
   * about — the open conversation's KV state.
   */
  beforeUnload?: () => Promise<void>;
  logger?: (line: string) => void;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
  baseEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  /** Minutes without work after which the model is unloaded (default 15; 0: never) — read each time it is armed. */
  idleUnloadMinutes?: number | (() => number);
  /** The model was unloaded for want of work, after that many minutes: told once it is down. */
  onIdleUnload?: (minutes: number) => void;
}

const DEFAULT_PORT = 8763;
const DEFAULT_IDLE_MINUTES = 15;

/** One spelling of a path, to find it in a command line. */
const normalised = (text: string): string => text.replace(/\\/g, '/').toLowerCase();

export class EngineSupervisor {
  private config: EngineConfig | null = null;
  private managed: ManagedServer | null = null;
  private remote: LlamaCppHttpClient | null = null;
  private remoteStatus: BackendStatus = 'stopped';
  private unsubscribe: (() => void) | null = null;
  private liveEngine: LiveEngine | null = null;
  private loadedModel: LoadedModel | null = null;
  private holds = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly measures: MeasureStore;
  private readonly probe: ProcessProbe;
  private readonly listeners = new Set<(status: BackendStatus) => void>();
  private readyCount = 0;
  private readonly log: (line: string) => void;

  constructor(private readonly options: EngineSupervisorOptions) {
    this.log = options.logger ?? ((line) => console.log(line));
    this.probe = options.processProbe ?? defaultProcessProbe;
    this.measures = options.measures ?? new MeasureStore();
  }

  get loaded(): LoadedModel | null {
    return this.loadedModel;
  }

  get live(): LiveEngine | null {
    return this.liveEngine;
  }

  get engine(): EngineConfig | null {
    return this.config;
  }

  /** The pid of the managed server, while it runs — for whoever watches its footprint. */
  get serverPid(): number | null {
    return this.managed?.pid ?? null;
  }

  /** How long this model took to load on this machine, last time; undefined if never measured. */
  loadSeconds(modelPath: string): number | undefined {
    return this.measures.get(modelPath)?.loadSeconds;
  }

  /** How many servers became ready: a relaunched one — after a crash, a stop, another model — has empty slots. */
  get generation(): number {
    return this.readyCount;
  }

  status(): BackendStatus {
    if (this.config?.mode === 'remote') return this.remoteStatus;
    return this.managed?.status() ?? 'stopped';
  }

  onStatusChange(listener: (status: BackendStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The client of the engine that serves now; undefined when none does. */
  client(): LlamaCppHttpClient | undefined {
    if (this.config?.mode === 'remote') return this.remoteStatus === 'ready' ? (this.remote ?? undefined) : undefined;
    return this.managed?.status() === 'ready' ? this.managed.client : undefined;
  }

  /**
   * Registers the engine WITHOUT reaching it. A running server is stopped
   * first: the configuration that launched it no longer holds.
   */
  async configure(config: EngineConfig): Promise<void> {
    if (config.mode === 'managed' && !this.options.llamaCommand) assertLlamaBinary(config.binPath);
    await this.teardown();
    this.config = config;
  }

  /** Remote engine: joins the server and reads what it serves. Managed: nothing to do without a model. */
  async connect(): Promise<BackendStatus> {
    if (!this.config) throw new Error('Engine not configured.');
    if (this.config.mode !== 'remote') return this.status();
    await this.teardown();
    const client = new LlamaCppHttpClient(this.config.url);
    this.remote = client;
    this.setRemoteStatus('starting');
    if (!(await client.health())) {
      this.setRemoteStatus('crashed');
      throw new Error(`The llama.cpp server at ${this.config.url} does not answer.`);
    }
    const props = await client.props();
    this.loadedModel = { modelPath: props.modelPath, nCtx: props.nCtx };
    this.liveEngine = {
      modelFingerprint: `remote:${props.modelPath}`,
      nCtx: props.nCtx,
      cacheTypeK: 'f16',
      cacheTypeV: 'f16',
      buildTag: 'unknown',
    };
    this.setRemoteStatus('ready');
    return this.status();
  }

  /**
   * Guarantees a managed server serving THIS model with the engine's launch
   * parameters. Same model, ready: nothing happens. Another model, or a
   * server that died: the caller saves first, the previous server goes down,
   * a new one comes up.
   */
  async ensureLoaded(modelPath: string): Promise<void> {
    if (!this.config) throw new Error('Engine not configured.');
    if (this.config.mode !== 'managed') return;
    const engine = this.config;

    if (this.managed && this.loadedModel?.modelPath === modelPath && this.managed.status() === 'ready') {
      this.armIdleTimer();
      return;
    }
    if (this.managed) {
      if (this.managed.status() === 'ready') await this.options.beforeUnload?.();
      await this.teardown();
    }

    const { command, prefixArgs, versionArgs } = this.commandFor(engine.binPath);
    const slots = engine.slots ?? 1;
    const cacheType = engine.cacheType ?? 'f16';
    const server = new ManagedServer({
      command,
      prefixArgs,
      launch: {
        modelPath,
        port: this.options.port ?? DEFAULT_PORT,
        // -c is shared between the slots: each gets the context asked.
        nCtx: engine.nCtx * slots,
        slots,
        ...(engine.gpuLayers !== undefined ? { gpuLayers: engine.gpuLayers } : {}),
        cacheTypeK: cacheType,
        cacheTypeV: cacheType,
        slotSavePath: this.options.slotsDir,
      },
      log: this.log,
      onProcess: (pid) => void (pid === null ? this.forgetPid() : this.rememberPid(pid)),
      ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
      ...(this.options.baseEnv ? { baseEnv: this.options.baseEnv } : {}),
      ...(this.options.platform ? { platform: this.options.platform } : {}),
      ...(this.options.healthIntervalMs !== undefined ? { healthIntervalMs: this.options.healthIntervalMs } : {}),
      ...(this.options.healthTimeoutMs !== undefined ? { healthTimeoutMs: this.options.healthTimeoutMs } : {}),
    });
    this.adopt(server);

    await mkdir(this.options.slotsDir, { recursive: true });
    const started = Date.now();
    await server.start();
    this.measures.record(modelPath, { loadSeconds: (Date.now() - started) / 1000, lastLoadedAt: new Date().toISOString() });

    const real = server.slotContext;
    if (real !== undefined && real !== engine.nCtx) {
      this.log(`[bonaparte] llama-server gives each slot ${real} tokens of context, not the ${engine.nCtx} asked.`);
    }
    const nCtx = real ?? engine.nCtx;
    this.loadedModel = { modelPath, nCtx };
    this.liveEngine = {
      modelFingerprint: await (this.options.fingerprint ?? fingerprintModelFile)(modelPath),
      nCtx,
      cacheTypeK: cacheType,
      cacheTypeV: cacheType,
      buildTag: await readBuildTag(command, versionArgs, this.options.spawn),
    };
    this.armIdleTimer();
  }

  /**
   * Work in progress (a turn): the model is not unloaded while one is held.
   * The while without work is counted from the last release.
   */
  /** A turn holds the engine: it is neither unloaded nor restarted under it. */
  get held(): boolean {
    return this.holds > 0;
  }

  hold(): () => void {
    this.holds += 1;
    this.clearIdleTimer();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      this.armIdleTimer();
    };
  }

  /** Stops the server (if any) and forgets what it served; the configuration stays. */
  async stop(): Promise<void> {
    await this.teardown();
  }

  /**
   * A server left behind by a session that died (a crash, a hot reload in
   * development) keeps a model of several GB in memory with nothing attached
   * to it. The trace names its pid; its command line must name our slots
   * folder before it is killed: a pid gets recycled, and another llama-server
   * on the machine is not ours to stop.
   */
  async killOrphan(): Promise<void> {
    let recorded: string;
    try {
      recorded = await readFile(this.options.pidFile, 'utf8');
    } catch {
      return;
    }
    await this.forgetPid();
    let pid: unknown;
    try {
      pid = (JSON.parse(recorded) as { pid?: unknown }).pid;
    } catch {
      return;
    }
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
    const commandLine = await this.probe.commandLine(pid);
    if (commandLine === null || !normalised(commandLine).includes(normalised(this.options.slotsDir))) return;
    this.log(`[bonaparte] a llama-server left by an earlier session (pid ${pid}) is stopped.`);
    await this.probe.kill(pid);
  }

  private commandFor(binPath: string): { command: string; prefixArgs: string[]; versionArgs: string[] } {
    const injected = this.options.llamaCommand;
    if (injected && injected.length > 0) {
      const rest = injected.slice(1);
      return { command: injected[0]!, prefixArgs: rest, versionArgs: [...rest, '--version'] };
    }
    // The unified CLI takes `serve` before the server's flags, not before --version.
    return { command: binPath, prefixArgs: detectServeCommandPrefix(binPath), versionArgs: ['--version'] };
  }

  private adopt(server: ManagedServer): void {
    this.managed = server;
    this.unsubscribe = server.onStatusChange((status) => this.emit(status));
  }

  private emit(status: BackendStatus): void {
    if (status === 'ready') this.readyCount += 1;
    for (const listener of this.listeners) listener(status);
  }

  private setRemoteStatus(status: BackendStatus): void {
    if (status === this.remoteStatus) return;
    this.remoteStatus = status;
    this.emit(status);
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    const setting = this.options.idleUnloadMinutes;
    const minutes = (typeof setting === 'function' ? setting() : setting) ?? DEFAULT_IDLE_MINUTES;
    if (minutes <= 0 || this.holds > 0 || !this.managed) return;
    this.idleTimer = setTimeout(() => void this.unloadIdle(minutes), minutes * 60_000);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async unloadIdle(minutes: number): Promise<void> {
    this.idleTimer = null;
    if (this.holds > 0 || !this.managed || this.managed.status() !== 'ready') return;
    this.log(
      `[bonaparte] no work for ${minutes} min: the model is unloaded (the memory of the conversations stays on disk).`,
    );
    await this.options.beforeUnload?.().catch(() => undefined);
    await this.teardown();
    this.options.onIdleUnload?.(minutes);
  }

  private async teardown(): Promise<void> {
    this.clearIdleTimer();
    // Forgotten first: the 'stopped' the server announces is heard with the
    // state it describes, not with the model it no longer serves.
    this.liveEngine = null;
    this.loadedModel = null;
    const server = this.managed;
    if (server) {
      // The 'stopped' the server announces is part of the story listeners
      // follow: the subscription outlives the stop.
      await server.stop().catch(() => undefined);
      await this.forgetPid();
    }
    if (this.remote) this.setRemoteStatus('stopped');
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.managed = null;
    this.remote = null;
    this.liveEngine = null;
    this.loadedModel = null;
  }

  private async rememberPid(pid: number): Promise<void> {
    try {
      await mkdir(dirname(this.options.pidFile), { recursive: true });
      await writeJsonFile(this.options.pidFile, { pid });
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
