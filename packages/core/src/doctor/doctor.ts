/**
 * Doctor — checks that the machine can run bonaparte.
 * The logic is pure: all system access goes through an injected
 * `DoctorEnv` (testable with no real machine). The system implementation
 * lives in doctor-env.ts.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import {
  isSupportedLlamaBuild,
  MIN_LLAMA_BUILD,
  parseLlamaBuildNumber,
} from '../backend/llamacpp/version.js';
import { harnessT } from '../i18n/translations.js';

export interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';
  name: string;
}

export interface DoctorEnv {
  /** e.g. process.version: "v24.14.0" */
  nodeVersion: string;
  /** llama-server path configured by the user (config), otherwise null. */
  configuredLlamaServerPath: string | null;
  fileExists(path: string): Promise<boolean>;
  /** PATH resolution (where/which) — null if absent. */
  lookupOnPath(binary: string): Promise<string | null>;
  /** Output of `<binary> --version` — null if not runnable. */
  readVersionOutput(binPath: string): Promise<string | null>;
  /** Directory where KV states will be written (--slot-save-path). */
  slotSavePath: string;
  canWrite(dir: string): Promise<boolean>;
  /** Free bytes on the directory's volume, null if it cannot be determined. */
  freeDiskBytes(dir: string): Promise<number | null>;
  detectGpu(): Promise<GpuInfo[]>;
}

export type DoctorCheckId = 'node' | 'llama-server' | 'slot-save-path' | 'gpu';
export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: DoctorCheckId;
  label: string;
  status: DoctorStatus;
  /** A blocking failure prevents bonaparte from working. */
  blocking: boolean;
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** true if there is no blocking failure. */
  ok: boolean;
}

export const MIN_NODE_MAJOR = 20;
export const LOW_DISK_BYTES = 10 * 1024 ** 3;

function nodeMajor(version: string): number {
  const major = Number.parseInt(version.replace(/^v/, ''), 10);
  return Number.isNaN(major) ? 0 : major;
}

async function checkNode(
  env: DoctorEnv,
  label: string,
  requiredMessage: string,
): Promise<DoctorCheck> {
  const ok = nodeMajor(env.nodeVersion) >= MIN_NODE_MAJOR;
  return {
    id: 'node',
    label,
    status: ok ? 'ok' : 'fail',
    blocking: !ok,
    detail: ok
      ? env.nodeVersion
      : `${env.nodeVersion} (${requiredMessage.replace('{min}', String(MIN_NODE_MAJOR))})`,
  };
}

async function checkLlamaServer(
  env: DoctorEnv,
  label: string,
  messages: {
    notFound: string;
    tooOld: string;
    versionUnknown: string;
  },
): Promise<DoctorCheck> {
  const base = { id: 'llama-server' as const, label };

  let binPath: string | null = null;
  if (env.configuredLlamaServerPath) {
    const exists = await env.fileExists(env.configuredLlamaServerPath);
    // A configured path that points to nothing is a config error:
    // explicit failure, no silent fallback to PATH.
    if (!exists) {
      return {
        ...base,
        status: 'fail',
        blocking: true,
        detail: env.configuredLlamaServerPath,
      };
    }
    binPath = env.configuredLlamaServerPath;
  } else {
    // Historical binary first, then the unified CLI (`llama serve`, b10xxx+).
    binPath =
      (await env.lookupOnPath('llama-server')) ??
      (await env.lookupOnPath('llama'));
  }

  if (!binPath) {
    return { ...base, status: 'fail', blocking: true, detail: messages.notFound };
  }

  const versionOutput = await env.readVersionOutput(binPath);
  const build = versionOutput === null ? null : parseLlamaBuildNumber(versionOutput);

  if (build === null) {
    return {
      ...base,
      status: 'warn',
      blocking: false,
      detail: `${binPath} — ${messages.versionUnknown}`,
    };
  }
  if (!isSupportedLlamaBuild(build)) {
    return {
      ...base,
      status: 'fail',
      blocking: true,
      detail: `${binPath} — b${build} < b${MIN_LLAMA_BUILD} : ${messages.tooOld}`,
    };
  }
  return { ...base, status: 'ok', blocking: false, detail: `${binPath} (b${build})` };
}

async function checkSlotSavePath(
  env: DoctorEnv,
  label: string,
  notWritableMessage: string,
  lowDiskMessage: string,
  gibUnit: string,
): Promise<DoctorCheck> {
  const base = { id: 'slot-save-path' as const, label };

  const writable = await env.canWrite(env.slotSavePath);
  if (!writable) {
    return {
      ...base,
      status: 'fail',
      blocking: true,
      detail: `${notWritableMessage} (${env.slotSavePath})`,
    };
  }

  const free = await env.freeDiskBytes(env.slotSavePath);
  if (free !== null && free < LOW_DISK_BYTES) {
    const gib = (free / 1024 ** 3).toFixed(1);
    return {
      ...base,
      status: 'warn',
      blocking: false,
      detail: `${lowDiskMessage} (${gib} ${gibUnit})`,
    };
  }

  return { ...base, status: 'ok', blocking: false, detail: env.slotSavePath };
}

async function checkGpu(
  env: DoctorEnv,
  label: string,
  cpuOnlyMessage: string,
): Promise<DoctorCheck> {
  const gpus = await env.detectGpu();
  if (gpus.length === 0) {
    return { id: 'gpu', label, status: 'warn', blocking: false, detail: cpuOnlyMessage };
  }
  return {
    id: 'gpu',
    label,
    status: 'ok',
    blocking: false,
    detail: gpus.map((g) => g.name).join(', '),
  };
}

export async function runDoctor(
  env: DoctorEnv,
  locale: BonaparteLocale,
): Promise<DoctorReport> {
  const t = harnessT(locale);

  const checks = [
    await checkNode(env, t.doctor.checkNode, t.doctor.nodeRequired),
    await checkLlamaServer(env, t.doctor.checkLlamaServer, {
      notFound: t.errors.llamaServerNotFound,
      tooOld: t.errors.llamaTooOld,
      versionUnknown: t.doctor.versionUnknown,
    }),
    await checkSlotSavePath(
      env,
      t.doctor.checkSlotSavePath,
      t.errors.slotSavePathNotWritable,
      t.doctor.lowDisk,
      t.doctor.gib,
    ),
    await checkGpu(env, t.doctor.checkGpu, t.doctor.cpuOnly),
  ];

  return {
    checks,
    ok: checks.every((c) => !(c.status === 'fail' && c.blocking)),
  };
}
