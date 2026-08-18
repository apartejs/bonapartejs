/**
 * Implémentation système de DoctorEnv — la seule partie du doctor qui touche
 * la machine. Volontairement fine : toute la logique est dans doctor.ts,
 * testée avec un environnement simulé.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { kvSlotsDir } from '../paths.js';
import type { DoctorEnv, GpuInfo } from './doctor.js';

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function lookupOnPath(binary: string): Promise<string | null> {
  const isWin = process.platform === 'win32';
  const out = await run(isWin ? 'where' : 'which', [binary]);
  const first = out?.split(/\r?\n/).find((l) => l.trim().length > 0);
  return first?.trim() ?? null;
}

async function detectGpu(): Promise<GpuInfo[]> {
  // Détection basique (J1-2) — le doctor complet (variantes CUDA/Vulkan/ROCm
  // pour le téléchargeur de binaires) arrive en J5.
  const gpus: GpuInfo[] = [];

  const nvidia = await run('nvidia-smi', [
    '--query-gpu=name',
    '--format=csv,noheader',
  ]);
  if (nvidia) {
    for (const line of nvidia.split(/\r?\n/)) {
      const name = line.trim();
      if (name) gpus.push({ vendor: 'nvidia', name });
    }
  }

  if (gpus.length === 0 && process.platform === 'darwin' && process.arch === 'arm64') {
    gpus.push({ vendor: 'apple', name: 'Apple Silicon (Metal)' });
  }

  if (gpus.length === 0 && (await lookupOnPath('vulkaninfo'))) {
    gpus.push({ vendor: 'unknown', name: 'GPU Vulkan' });
  }

  return gpus;
}

export interface SystemDoctorEnvOptions {
  /** Chemin llama-server issu de la config utilisateur (quand elle existera). */
  configuredLlamaServerPath?: string | null;
  slotSavePath?: string;
}

export function createSystemDoctorEnv(
  options: SystemDoctorEnvOptions = {},
): DoctorEnv {
  const slotSavePath = options.slotSavePath ?? kvSlotsDir();

  return {
    nodeVersion: process.version,
    configuredLlamaServerPath: options.configuredLlamaServerPath ?? null,
    readVersionOutput: async (binPath) => {
      // llama peut écrire la version sur stderr : on capture les deux.
      try {
        const { stdout, stderr } = await execFileAsync(binPath, ['--version'], {
          timeout: 5_000,
          windowsHide: true,
        });
        return `${stdout}\n${stderr}`;
      } catch (error) {
        // execFile rejette aussi quand l'exit code ≠ 0 mais la sortie existe.
        const e = error as { stdout?: string; stderr?: string };
        const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim();
        return out.length > 0 ? out : null;
      }
    },
    fileExists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    lookupOnPath,
    slotSavePath,
    canWrite: async (dir) => {
      try {
        await mkdir(dir, { recursive: true });
        const probe = join(dir, `.bp-write-probe-${process.pid}`);
        await writeFile(probe, 'probe');
        await rm(probe, { force: true });
        return true;
      } catch {
        return false;
      }
    },
    freeDiskBytes: async (dir) => {
      try {
        const stats = await statfs(dir);
        return Number(stats.bsize) * Number(stats.bavail);
      } catch {
        return null;
      }
    },
    detectGpu,
  };
}
