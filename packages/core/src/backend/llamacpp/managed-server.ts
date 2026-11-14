/**
 * The llama-server bonaparte launches and watches.
 *
 * - One random key per server, in its environment: it answers to us alone —
 *   not to a web page on this machine, not to another program.
 * - Ready only once it answers AND serves our model: `/health` only says that
 *   something answers on the port; `/props` says what. A server that refuses
 *   our key, or serves another file, is not the one we launched.
 * - After an unexpected exit it is relaunched, at most twice; then it is
 *   crashed, and stays so until someone starts it again.
 */

import { randomBytes } from 'node:crypto';
import type { SpawnFn } from '../../process/spawn.js';
import { launchServer, serverEnvironment, type ServerProcess } from '../../engine/server-process.js';
import type { BackendStatus } from '../types.js';
import { buildLlamaServerArgs, type LlamaCppLaunchConfig } from './args.js';
import { LlamaCppHttpClient } from './http-client.js';

export interface ManagedServerOptions {
  /** The program: llama-server, the unified `llama` CLI, or in tests Node. */
  command: string;
  /** Before llama-server's own arguments: the CLI's `serve`, or the fake binary. */
  prefixArgs?: readonly string[];
  launch: LlamaCppLaunchConfig;
  /** The environment the server's is made from, secrets removed (default: this process's). */
  baseEnv?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  healthIntervalMs?: number;
  /** How long a load may take before the server is given up (default: two minutes). */
  healthTimeoutMs?: number;
  maxRestarts?: number;
  /** Told the pid of each launch, and null once it is gone: the trace an orphan is found by. */
  onProcess?: (pid: number | null) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Two spellings of one file: case and separators do not tell models apart on Windows. */
function sameModelPath(a: string, b: string): boolean {
  const norm = (path: string): string => path.replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

export class ManagedServer {
  readonly client: LlamaCppHttpClient;
  private readonly key = randomBytes(24).toString('base64url');
  private process: ServerProcess | null = null;
  private currentStatus: BackendStatus = 'stopped';
  private readonly listeners = new Set<(status: BackendStatus) => void>();
  private intentionalStop = false;
  private restartCount = 0;
  private context: number | undefined;

  constructor(private readonly options: ManagedServerOptions) {
    this.client = new LlamaCppHttpClient(`http://127.0.0.1:${options.launch.port}`, this.key);
  }

  status(): BackendStatus {
    return this.currentStatus;
  }

  onStatusChange(listener: (status: BackendStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The pid of the running server, if one runs. */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  /** The context one slot really has, read in `/props` once the server serves. */
  get slotContext(): number | undefined {
    return this.context;
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    this.restartCount = 0;
    await this.spawnAndWait('starting');
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    const running = this.process;
    this.process = null;
    if (running) {
      await running.stop();
      this.options.onProcess?.(null);
    }
    this.setStatus('stopped');
  }

  private setStatus(status: BackendStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  /** Every line the server writes, with the key hidden should it ever appear. */
  private log(line: string): void {
    this.options.log?.(line.split(this.key).join('***'));
  }

  private async spawnAndWait(status: 'starting' | 'restarting'): Promise<void> {
    this.setStatus(status);
    const args = [...(this.options.prefixArgs ?? []), ...buildLlamaServerArgs(this.options.launch)];
    const running = launchServer(this.options.command, args, {
      env: serverEnvironment(this.options.baseEnv ?? process.env, this.key),
      log: (line) => this.log(line),
      ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
      ...(this.options.platform ? { platform: this.options.platform } : {}),
    });
    this.process = running;
    if (running.pid !== undefined) this.options.onProcess?.(running.pid);
    void running.exited.then((code) => this.onProcessExit(running, code));

    const interval = this.options.healthIntervalMs ?? 500;
    const timeout = this.options.healthTimeoutMs ?? 120_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!running.running) {
        this.setStatus('crashed');
        const said = running.lastLines();
        throw new Error(`llama-server stopped before it was ready.${said ? `\n${said}` : ''}`);
      }
      if (await this.client.health()) {
        await this.verifyServedModel(running);
        this.setStatus('ready');
        return;
      }
      await sleep(interval);
    }

    await this.giveUp(running);
    throw new Error(`llama-server is not responding after ${timeout} ms (${this.client.baseUrl}).`);
  }

  /**
   * Health only says SOMETHING answers on the port. `/props` says what: a
   * server that refuses our key, or serves another model, is not the one we
   * launched — a leftover, another program's — and is not talked to.
   */
  private async verifyServedModel(running: ServerProcess): Promise<void> {
    const port = this.options.launch.port;
    let props;
    try {
      props = await this.client.props();
    } catch (error) {
      await this.giveUp(running);
      throw new Error(
        `The server on port ${port} is not the one bonaparte launched: it refuses our key ` +
          `(${error instanceof Error ? error.message : String(error)}).`,
      );
    }
    if (props.modelPath && !sameModelPath(props.modelPath, this.options.launch.modelPath)) {
      await this.giveUp(running);
      throw new Error(
        `The server on port ${port} serves ${props.modelPath}, not ${this.options.launch.modelPath}: ` +
          'another llama-server holds the port.',
      );
    }
    this.context = props.nCtx > 0 ? props.nCtx : undefined;
  }

  private async giveUp(running: ServerProcess): Promise<void> {
    if (this.process === running) this.process = null;
    await running.stop();
    this.setStatus('crashed');
  }

  private onProcessExit(running: ServerProcess, code: number | null): void {
    if (this.process !== running) return; // a process from a previous life
    // Before it was ready, a launch that fails is the launch's to report.
    if (this.currentStatus !== 'ready') return;
    this.process = null;
    this.options.onProcess?.(null);

    if (this.intentionalStop) {
      this.setStatus('stopped');
      return;
    }
    if (this.restartCount >= (this.options.maxRestarts ?? 2)) {
      this.log(`[bonaparte] llama-server left (code ${code}) and was relaunched too often: given up.`);
      this.setStatus('crashed');
      return;
    }
    this.restartCount += 1;
    this.log(`[bonaparte] llama-server left (code ${code}): relaunching (${this.restartCount}).`);
    void this.spawnAndWait('restarting').catch(() => {
      // spawnAndWait has already said crashed.
    });
  }
}
