/**
 * `bonaparte doctor` (task 9.6, ported from v0): what the machine has for the built-in engine — Node,
 * llama.cpp, the folder the memories are saved in, the card. Pure: what it reads comes through a
 * `DoctorEnv`, which the core fills with its own ways of finding llama.cpp and measuring the card. It says
 * facts, never sentences: the command that prints them says them in the person's language.
 */

import { buildNumber } from '../engine/llama-release.js';
import { MIN_LLAMA_BUILD } from '../backend/llamacpp/version.js';

/** The Node the command runs on: the oldest release still maintained. */
export const MIN_NODE_MAJOR = 22;
/** Under this, the memories may not find room on the disk: a warning. */
export const LOW_DISK_BYTES = 10 * 1024 ** 3;

export interface DoctorEnv {
  nodeVersion: string;
  /** The llama.cpp a load would run, as the core finds it; `build` null when it does not answer. */
  llama(): Promise<{ source: 'configured' | 'managed' | 'path'; command: string; build: string | null } | null>;
  slotsDir: string;
  canWrite(dir: string): Promise<boolean>;
  freeDiskBytes(dir: string): Promise<number | null>;
  /** The card's video memory, as llama.cpp says it; null when none is measured. */
  gpuBytes(): Promise<number | null>;
  /**
   * On Windows, the Visual C++ runtime llama.cpp's package needs and does not carry (`engine/llama-runtime.ts`): the
   * one beside the llama.cpp found, Windows' own, the one bonaparte carries — each a version, null when incomplete —
   * and whether that llama.cpp is the one bonaparte installed (the only one it puts its runtime beside). Null
   * elsewhere than Windows.
   */
  runtime?(): Promise<{ system: string | null; carried: string | null; beside: string | null; managed: boolean } | null>;
}

export type DoctorStatus = 'ok' | 'warn' | 'fail';

interface CheckBase {
  status: DoctorStatus;
  /** A failure that keeps the built-in engine from running. */
  blocking: boolean;
}

export type DoctorCheck =
  | (CheckBase & { id: 'node'; version: string; min: number })
  | (CheckBase & {
      id: 'llama';
      found: boolean;
      source?: 'configured' | 'managed' | 'path';
      command?: string;
      build?: string | null;
      /** Its build is older than the oldest one bonaparte runs, `minBuild`. */
      tooOld?: boolean;
      minBuild?: number;
    })
  | (CheckBase & {
      id: 'runtime';
      /** Which runtime llama.cpp will load: the one beside it, Windows' own, or the one bonaparte puts there; null: none. */
      runs: 'beside' | 'system' | 'carried' | null;
      version: string | null;
    })
  | (CheckBase & { id: 'slots'; dir: string; writable: boolean; freeBytes: number | null })
  | (CheckBase & { id: 'gpu'; bytes: number | null });

export interface DoctorReport {
  checks: DoctorCheck[];
  /** No failure blocks the built-in engine. */
  ok: boolean;
}

function checkNode(version: string): DoctorCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  const ok = major >= MIN_NODE_MAJOR;
  return { id: 'node', status: ok ? 'ok' : 'fail', blocking: !ok, version, min: MIN_NODE_MAJOR };
}

async function checkLlama(env: DoctorEnv): Promise<DoctorCheck> {
  const llama = await env.llama();
  if (!llama) return { id: 'llama', status: 'fail', blocking: true, found: false };
  const base = { id: 'llama' as const, found: true, source: llama.source, command: llama.command, build: llama.build };
  // A llama.cpp the person named that does not answer: said, never replaced by another one.
  if (llama.build === null) return { ...base, status: 'fail', blocking: true };
  const number = buildNumber(llama.build);
  if (number === null) return { ...base, status: 'warn', blocking: false };
  if (number < MIN_LLAMA_BUILD) return { ...base, status: 'fail', blocking: true, tooOld: true, minBuild: MIN_LLAMA_BUILD };
  return { ...base, status: 'ok', blocking: false };
}

/**
 * The runtime the llama.cpp found will load, in Windows' order: beside it first, then Windows' own; else the one
 * bonaparte puts beside the build it installed. None: llama.cpp's official package stops before its first line.
 * Whether that runtime is recent enough for the build is not known before it runs: the engine says it then.
 */
async function checkRuntime(env: DoctorEnv): Promise<DoctorCheck | null> {
  const runtime = await env.runtime?.().catch(() => null);
  if (!runtime) return null;
  const [runs, version]: [Extract<DoctorCheck, { id: 'runtime' }>['runs'], string | null] =
    runtime.beside !== null
      ? ['beside', runtime.beside]
      : runtime.system !== null
        ? ['system', runtime.system]
        : runtime.carried !== null && runtime.managed
          ? ['carried', runtime.carried]
          : [null, null];
  return { id: 'runtime', status: runs ? 'ok' : 'fail', blocking: !runs, runs, version };
}

async function checkSlots(env: DoctorEnv): Promise<DoctorCheck> {
  const writable = await env.canWrite(env.slotsDir);
  const freeBytes = writable ? await env.freeDiskBytes(env.slotsDir) : null;
  const status: DoctorStatus = !writable ? 'fail' : freeBytes !== null && freeBytes < LOW_DISK_BYTES ? 'warn' : 'ok';
  return { id: 'slots', status, blocking: !writable, dir: env.slotsDir, writable, freeBytes };
}

async function checkGpu(env: DoctorEnv): Promise<DoctorCheck> {
  const bytes = await env.gpuBytes().catch(() => null);
  return { id: 'gpu', status: bytes === null ? 'warn' : 'ok', blocking: false, bytes };
}

export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const runtime = await checkRuntime(env);
  const checks = [checkNode(env.nodeVersion), await checkLlama(env), ...(runtime ? [runtime] : []), await checkSlots(env), await checkGpu(env)];
  return { checks, ok: !checks.some((check) => check.status === 'fail' && check.blocking) };
}
