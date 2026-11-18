/**
 * ResourceMonitor — what the machine is doing while a model runs.
 *
 * CPU and RAM come from Node (`os`), everywhere. GPU memory and load, and
 * the server process's footprint, come from a PowerShell child on Windows
 * (WDDM counters through `Get-Counter`, `Get-Process` for the pid) — one
 * long-lived child, because starting one costs more than a second and a
 * sample is wanted every few seconds. Elsewhere those figures are absent,
 * and said absent: a gauge that guesses is worse than no gauge.
 *
 * Every probe is injectable; the specs run with fakes.
 */

import { withoutSecrets } from '../process/env.js';
import { createInterface } from 'node:readline';
import { cpus, freemem, totalmem } from 'node:os';
import { spawnHidden, type SpawnedProcess, type SpawnFn } from '../process/spawn.js';

export interface MemoryReading {
  usedBytes: number;
  totalBytes: number;
}

export interface SystemReading {
  /** 0–100 over every core; null until two readings exist. */
  cpu: number | null;
  memory: MemoryReading;
}

/** A figure the machine does not report is null: unknown, never zero. */
export interface GpuReading {
  dedicatedBytes: number | null;
  sharedBytes: number | null;
  /** 0–100, 3D + compute engines summed and capped; null when unknown. */
  utilization: number | null;
}

export interface ProcessReading {
  pid: number;
  workingSetBytes: number;
  /** 0–100 of one core-equivalent over all cores; null until two readings exist. */
  cpu: number | null;
}

export interface AppFootprint {
  workingSetBytes: number;
  cpu: number | null;
}

export interface ResourceSample {
  at: number;
  cpu: number | null;
  memory: MemoryReading;
  gpu: GpuReading | null;
  /** The managed llama-server, when one runs and the platform can see it. */
  server: ProcessReading | null;
  /** bonaparte's own processes, when the host reports them. */
  app: AppFootprint | null;
}

export type SystemProbe = () => Promise<SystemReading>;
export type GpuProbe = () => Promise<GpuReading | null>;
export type ServerProbe = () => Promise<ProcessReading | null>;

export interface ResourceMonitorOptions {
  intervalMs?: number;
  system: SystemProbe;
  gpu?: GpuProbe;
  serverProcess?: ServerProbe;
  app?: () => AppFootprint | null;
}

const DEFAULT_INTERVAL_MS = 3000;

export class ResourceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSample: ResourceSample | null = null;
  private sampling = false;
  private readonly listeners = new Set<(sample: ResourceSample) => void>();

  constructor(private readonly options: ResourceMonitorOptions) {}

  onSample(listener: (sample: ResourceSample) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  last(): ResourceSample | null {
    return this.lastSample;
  }

  start(): void {
    if (this.timer) return;
    const interval = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => void this.sample(), interval);
    // The interval's own handle must not keep a host alive on its own.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sample(): Promise<void> {
    // A slow probe never piles up: a tick that finds one in flight is skipped.
    if (this.sampling || !this.timer) return;
    this.sampling = true;
    try {
      const [system, gpu, server] = await Promise.all([
        this.options.system(),
        quiet(this.options.gpu),
        quiet(this.options.serverProcess),
      ]);
      if (!this.timer) return; // stopped meanwhile
      const sample: ResourceSample = {
        at: Date.now(),
        cpu: system.cpu,
        memory: system.memory,
        gpu,
        server,
        app: this.options.app?.() ?? null,
      };
      this.lastSample = sample;
      for (const listener of this.listeners) listener(sample);
    } catch {
      /* the system probe failed: no sample this tick, the next one may do */
    } finally {
      this.sampling = false;
    }
  }
}

async function quiet<T>(probe: (() => Promise<T | null>) | undefined): Promise<T | null> {
  if (!probe) return null;
  try {
    return await probe();
  } catch {
    return null;
  }
}

// ── CPU from the cores' times ───────────────────────────────────────────

export interface CoreTimes {
  idle: number;
  total: number;
}

/** Busy share of every core between two readings, 0–100; null when no time elapsed. */
export function cpuPercentBetween(before: CoreTimes[], after: CoreTimes[]): number | null {
  let idle = 0;
  let total = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    idle += after[i]!.idle - before[i]!.idle;
    total += after[i]!.total - before[i]!.total;
  }
  if (total <= 0) return null;
  return Math.round(((total - idle) / total) * 1000) / 10;
}

function coreTimes(): CoreTimes[] {
  return cpus().map(({ times }) => ({
    idle: times.idle,
    total: times.user + times.nice + times.sys + times.irq + times.idle,
  }));
}

/**
 * CPU and RAM from Node, on every platform. Each probe keeps its own previous
 * reading, which its CPU figure is measured against: the first reading has none.
 */
export function createNodeSystemProbe(): SystemProbe {
  let previousCores: CoreTimes[] | null = null;
  return async () => {
    const cores = coreTimes();
    const cpu = previousCores ? cpuPercentBetween(previousCores, cores) : null;
    previousCores = cores;
    const totalBytes = totalmem();
    return { cpu, memory: { usedBytes: totalBytes - freemem(), totalBytes } };
  };
}

// ── Windows: GPU counters and the server process, from one PowerShell ──

export interface GpuLine {
  gpu: GpuReading | null;
  process: { workingSetBytes: number; cpuSeconds: number } | null;
}

/** One JSON line of the PowerShell probe; null when it is not one. */
export function parseGpuLine(line: string): GpuLine | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const num = (key: string): number | null =>
    typeof parsed[key] === 'number' && Number.isFinite(parsed[key]) ? (parsed[key] as number) : null;
  const dedicated = num('dedicated');
  const shared = num('shared');
  const util = num('util');
  const gpu =
    dedicated === null && shared === null
      ? null
      : {
          dedicatedBytes: dedicated,
          sharedBytes: shared,
          utilization: util === null ? null : Math.min(100, util),
        };
  const ws = num('ws');
  const cpuSeconds = num('cpu');
  const process = ws === null ? null : { workingSetBytes: ws, cpuSeconds: cpuSeconds ?? 0 };
  return { gpu, process };
}

/**
 * The script the child runs. English counter names: the GPU counters are
 * not localised (verified on a French Windows), unlike the processor and
 * memory ones — which is why CPU and RAM come from Node instead.
 */
function probeScript(pid: number, intervalSeconds: number): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$target = ${pid}`,
    'while ($true) {',
    "  $s = Get-Counter -Counter '\\GPU Adapter Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Shared Usage','\\GPU Engine(*engtype_3D)\\Utilization Percentage','\\GPU Engine(*engtype_Compute)\\Utilization Percentage' -MaxSamples 1",
    '  $cs = $s.CounterSamples',
    '  $o = [ordered]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }',
    "  $o.dedicated = (($cs | Where-Object { $_.Path -like '*dedicated usage*' }) | Measure-Object -Property CookedValue -Sum).Sum",
    "  $o.shared = (($cs | Where-Object { $_.Path -like '*shared usage*' }) | Measure-Object -Property CookedValue -Sum).Sum",
    "  $o.util = (($cs | Where-Object { $_.Path -like '*engtype_3d*' -or $_.Path -like '*engtype_compute*' }) | Measure-Object -Property CookedValue -Sum).Sum",
    '  if ($target -gt 0) { $p = Get-Process -Id $target; if ($p) { $o.ws = $p.WorkingSet64; $o.cpu = $p.TotalProcessorTime.TotalSeconds } }',
    '  $o | ConvertTo-Json -Compress',
    '  [Console]::Out.Flush()',
    `  Start-Sleep -Seconds ${intervalSeconds}`,
    '}',
  ].join('\n');
}

export interface WindowsProbes {
  gpu: GpuProbe;
  serverProcess: ServerProbe;
  /** Kills the child. */
  dispose(): void;
}

export interface WindowsProbesOptions {
  /** The managed server's pid, re-read at every sample; the child follows it. */
  serverPid: () => number | null;
  intervalSeconds?: number;
  /** Injected in tests: what `spawnHidden` launches with. */
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  /** Injected in tests: the clock a reading's age is measured on. */
  now?: () => number;
}

/**
 * GPU and server-process readings for Windows, from one PowerShell child
 * that prints a JSON line every few seconds. The child is (re)started when
 * the server's pid changes, since it reads that pid. Off Windows, both
 * probes answer null.
 */
export function createWindowsProbes(options: WindowsProbesOptions): WindowsProbes {
  const platform = options.platform ?? process.platform;
  const interval = options.intervalSeconds ?? 3;
  const now = options.now ?? Date.now;
  let child: SpawnedProcess | null = null;
  let childPid = -1;
  let latest: GpuLine | null = null;
  let latestAt = 0;
  let previous: { cpuSeconds: number; at: number } | null = null;

  const ensureChild = (): void => {
    if (platform !== 'win32') return;
    const pid = options.serverPid() ?? 0;
    if (child && childPid === pid) return;
    child?.kill();
    child = null;
    if (pid !== childPid) {
      // Another server: the last footprint read was the old one's. The
      // machine's video memory stays what it was until the new child reads it.
      previous = null;
      if (latest) latest = { gpu: latest.gpu, process: null };
    }
    childPid = pid;
    const encoded = Buffer.from(probeScript(pid, interval), 'utf16le').toString('base64');
    try {
      child = spawnHidden('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'ignore'],
        // A probe gets none of the app's secrets (audit 13.4).
        env: withoutSecrets(process.env),
        ...(options.spawn ? { spawn: options.spawn } : {}),
      });
    } catch {
      child = null;
      return;
    }
    const started = child;
    started.on('exit', () => {
      if (child === started) child = null;
    });
    if (started.stdout) {
      createInterface({ input: started.stdout }).on('line', (line) => {
        if (child !== started) return; // a child we replaced still talking
        const parsed = parseGpuLine(line);
        if (parsed) {
          latest = parsed;
          latestAt = now();
        }
      });
    }
  };

  return {
    gpu: async () => {
      ensureChild();
      // A reading older than three intervals is stale: the child died or stalled.
      if (!latest || now() - latestAt > interval * 3000) return null;
      return latest.gpu;
    },
    serverProcess: async () => {
      ensureChild();
      const pid = options.serverPid();
      if (!pid || !latest?.process || now() - latestAt > interval * 3000) return null;
      const { workingSetBytes, cpuSeconds } = latest.process;
      let cpu: number | null = null;
      if (previous && latestAt > previous.at) {
        const elapsed = (latestAt - previous.at) / 1000;
        const cores = Math.max(1, cpus().length);
        cpu = Math.round(Math.min(100, ((cpuSeconds - previous.cpuSeconds) / elapsed / cores) * 100) * 10) / 10;
      }
      previous = { cpuSeconds, at: latestAt };
      return { pid, workingSetBytes, cpu };
    },
    dispose: () => {
      child?.kill();
      child = null;
    },
  };
}
