/**
 * What a project runs (task 10.3, ported from v0's project-launcher): the scripts of its package.json and the
 * services of its compose file, read by the core — never a folder the window names. A launch is the person's
 * click: `[manager, 'run', name]` (or `docker compose up <service>`), hidden, an argument array, never a shell
 * — a script name is checked first (`dev & calc` launches nothing). Its output goes to the terminal; its address
 * is read from what it prints, and is ready once it answers. Stopped, its whole tree goes down (on Windows,
 * killing the wrapper alone left the dev server listening).
 */

import { Socket } from 'node:net';
import { resolveCommand } from '../mcp/command.js';
import type { SpawnedProcess, SpawnFn } from '../process/spawn.js';
import { spawnTree, stopProcessTree } from '../process/tree.js';
import type { CommandOutputEvent } from '../tools/types.js';
import { detectProject, type ProjectFacts } from './detect.js';

/** A script name that cannot be anything but a name (audit of 2026-08-28: `dev & powershell -enc …`). */
export function isSafeScriptName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/.test(name);
}

export interface RunView {
  kind: 'script' | 'service';
  name: string;
  /** As the person would type it: `pnpm dev`, `docker compose up api`. */
  command: string;
  state: 'stopped' | 'running' | 'exited';
  /** The address it announced; null until it does. */
  url: string | null;
  /** Its address answers. */
  ready?: true;
  exitCode?: number | null;
}

export interface ProjectRunsOptions {
  /** The environment a launch starts from: the app's minus its secrets. */
  env: () => Record<string, string>;
  /** What a launch prints, as it prints it (the terminal); `conversationId` the conversation it was started from. */
  output?: (event: CommandOutputEvent, conversationId?: string) => void;
  /** Tests only. */
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  /** The ports « déjà en marche » looks at. */
  ports?: readonly number[];
}

/** The ports dev servers usually take. */
const USUAL_PORTS = [3000, 3001, 4173, 4200, 5000, 5173, 5174, 6006, 8000, 8080, 8081, 8888];
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s"'\u001b]*/i;
const READY_TIMEOUT_MS = 60_000;

interface Running {
  key: string;
  child: SpawnedProcess;
  url: string | null;
  ready: boolean;
  exitCode?: number | null;
  exited: boolean;
}

const COMMANDS: Record<NonNullable<ProjectFacts['packageManager']>, string> = { pnpm: 'pnpm', yarn: 'yarn', bun: 'bun', npm: 'npm' };

export class ProjectRuns {
  private readonly running = new Map<string, Running>();

  constructor(private readonly options: ProjectRunsOptions) {}

  async list(root: string): Promise<{ manager: ProjectFacts['packageManager']; runs: RunView[] }> {
    const facts = await detectProject(root);
    const manager = facts.packageManager;
    const runs: RunView[] = [
      ...facts.scripts.filter(isSafeScriptName).map((name) => this.view(root, 'script', name, `${manager ?? 'npm'} ${name}`)),
      ...facts.services.filter(isSafeScriptName).map((name) => this.view(root, 'service', name, `docker compose up ${name}`)),
    ];
    return { manager, runs };
  }

  async start(root: string, kind: RunView['kind'], name: string, conversationId?: string): Promise<void> {
    if (!isSafeScriptName(name)) throw new Error(`« ${name} » is not a script name: nothing was launched.`);
    const facts = await detectProject(root);
    const known = kind === 'script' ? facts.scripts.includes(name) : facts.services.includes(name);
    if (!known) throw new Error(`The project has no ${kind} « ${name} ».`);
    const key = keyOf(root, kind, name);
    const current = this.running.get(key);
    if (current && !current.exited) return;

    const env = this.options.env();
    const program = kind === 'script' ? COMMANDS[facts.packageManager ?? 'npm'] : 'docker';
    const args = kind === 'script' ? ['run', name] : ['compose', 'up', name];
    const resolved = resolveCommand(program, args, { env, ...(this.options.platform ? { platform: this.options.platform } : {}) });
    const tell = (event: CommandOutputEvent): void => this.options.output?.(event, conversationId);
    tell({ kind: 'start', command: [program, ...args].join(' '), cwd: root });
    const child = spawnTree(resolved.command, resolved.args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
    });
    const run: Running = { key, child, url: null, ready: false, exited: false };
    this.running.set(key, run);
    // The address is read in whole lines: a pipe may cut one anywhere (« http://127.0.0.1: », then its port).
    let partial = '';
    const read = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      tell({ kind: 'data', text });
      if (run.url) return;
      const lines = (partial + text).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) {
        const found = URL_PATTERN.exec(line.replace(/\u001b\[[0-9;]*m/g, ''))?.[0];
        if (!found) continue;
        run.url = found.replace(/[.,;)]+$/, '');
        void this.waitReady(run);
        return;
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('exit', (code) => {
      run.exited = true;
      run.exitCode = code;
      tell({ kind: 'exit', code });
    });
    child.once('error', (error) => {
      run.exited = true;
      tell({ kind: 'data', text: `${error.message}\n` });
    });
  }

  async stop(root: string, name: string): Promise<void> {
    for (const kind of ['script', 'service'] as const) {
      const run = this.running.get(keyOf(root, kind, name));
      if (!run) continue;
      this.running.delete(run.key);
      await stopProcessTree(run.child, this.options.spawn ? { spawn: this.options.spawn } : {});
    }
  }

  async stopAll(): Promise<void> {
    const all = [...this.running.values()];
    this.running.clear();
    await Promise.all(all.map((run) => stopProcessTree(run.child, this.options.spawn ? { spawn: this.options.spawn } : {}).catch(() => undefined)));
  }

  /** The servers already running on this machine: the usual ports that answer, outside what is launched here. */
  async alreadyRunning(): Promise<string[]> {
    const ours = new Set(
      [...this.running.values()].flatMap((run) => {
        const port = run.url ? Number(new URL(run.url).port) : NaN;
        return Number.isFinite(port) ? [port] : [];
      }),
    );
    const ports = (this.options.ports ?? USUAL_PORTS).filter((port) => !ours.has(port));
    const answered = await Promise.all(ports.map(async (port) => ((await answers('127.0.0.1', port, 300)) ? port : null)));
    return answered.filter((port): port is number => port !== null).map((port) => `http://localhost:${port}/`);
  }

  private view(root: string, kind: RunView['kind'], name: string, command: string): RunView {
    const run = this.running.get(keyOf(root, kind, name));
    if (!run) return { kind, name, command, state: 'stopped', url: null };
    return {
      kind,
      name,
      command,
      state: run.exited ? 'exited' : 'running',
      url: run.url,
      ...(run.ready ? { ready: true as const } : {}),
      ...(run.exited ? { exitCode: run.exitCode ?? null } : {}),
    };
  }

  /** The address answers: a dev server announces itself a moment before it listens. */
  private async waitReady(run: Running): Promise<void> {
    if (!run.url) return;
    const url = new URL(run.url);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, '');
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!run.exited && Date.now() < deadline) {
      if (await answers(host, port, 500)) {
        run.ready = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

const keyOf = (root: string, kind: RunView['kind'], name: string): string => `${root}\u0000${kind}\u0000${name}`;

function answers(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}
