/**
 * What a folder already says about the project it holds, read before the
 * person creates one (board « Nouveau projet »): its git repository and
 * branch, its package manager and scripts, its instructions file, the
 * services of its compose file. Reading only: nothing is written in the
 * person's folder, and nothing is run — git's own state (changes in
 * progress) comes with the branches (6.7).
 */

import { isNetwork, NetworkPathError } from './paths.js';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { INSTRUCTION_FILES } from './instructions.js';

export interface ProjectFacts {
  /** The folder's name: what the dialog proposes as the project's. */
  name: string;
  /** The repository, when the folder is one: its branch, or the commit a detached head is on. */
  git: { branch: string; commit?: never } | { branch: null; commit: string } | null;
  packageManager: 'pnpm' | 'yarn' | 'bun' | 'npm' | null;
  /** The scripts of package.json, in its order. */
  scripts: string[];
  /** The instructions file the conversations will read, as found. */
  instructions: string | null;
  /** The services of the compose file. */
  services: string[];
}

const LOCKS: readonly [string, NonNullable<ProjectFacts['packageManager']>][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];
const MANAGERS = new Set(['pnpm', 'yarn', 'bun', 'npm']);
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

const exists = async (path: string): Promise<boolean> => (await stat(path).catch(() => null)) !== null;
const text = async (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null);

export async function detectProject(dir: string): Promise<ProjectFacts> {
  // Reading a network folder sends the person's credentials to its host: never.
  if (isNetwork(dir)) throw new NetworkPathError(dir);
  const root = resolve(dir);
  const [git, pkg, instructions, services] = await Promise.all([gitOf(root), packageOf(root), instructionsOf(root), servicesOf(root)]);
  return { name: basename(root), git, ...pkg, instructions, services };
}

async function gitOf(root: string): Promise<ProjectFacts['git']> {
  const dotGit = join(root, '.git');
  const found = await stat(dotGit).catch(() => null);
  if (!found) return null;
  // A worktree's .git is a file that names its git folder.
  let gitDir = dotGit;
  if (found.isFile()) {
    const pointer = /^gitdir:\s*(.+)$/m.exec((await text(dotGit)) ?? '')?.[1]?.trim();
    if (!pointer || isNetwork(pointer)) return null;
    gitDir = isAbsolute(pointer) ? pointer : resolve(root, pointer);
  }
  const head = (await text(join(gitDir, 'HEAD')))?.trim();
  if (!head) return null;
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  if (ref) return { branch: ref };
  return /^[0-9a-f]{7,64}$/i.test(head) ? { branch: null, commit: head.slice(0, 7) } : null;
}

async function packageOf(root: string): Promise<Pick<ProjectFacts, 'packageManager' | 'scripts'>> {
  const raw = await text(join(root, 'package.json'));
  if (raw === null) return { packageManager: null, scripts: [] };
  let manifest: { packageManager?: unknown; scripts?: unknown } = {};
  try {
    manifest = JSON.parse(raw) as typeof manifest;
  } catch {
    // A package.json it cannot read is no script, never a failure.
  }
  const scripts =
    typeof manifest.scripts === 'object' && manifest.scripts !== null && !Array.isArray(manifest.scripts) ? Object.keys(manifest.scripts) : [];
  const declared = typeof manifest.packageManager === 'string' ? manifest.packageManager.split('@')[0] : undefined;
  if (declared && MANAGERS.has(declared)) return { packageManager: declared as NonNullable<ProjectFacts['packageManager']>, scripts };
  for (const [lock, manager] of LOCKS) if (await exists(join(root, lock))) return { packageManager: manager, scripts };
  return { packageManager: 'npm', scripts };
}

async function instructionsOf(root: string): Promise<string | null> {
  for (const name of INSTRUCTION_FILES) if (await exists(join(root, name))) return name;
  return null;
}

/** The services of the compose file: the keys one level under `services:` — read, never interpreted further. */
async function servicesOf(root: string): Promise<string[]> {
  for (const name of COMPOSE_FILES) {
    const raw = await text(join(root, name));
    if (raw === null) continue;
    const services: string[] = [];
    let inside = false;
    let indent: number | null = null;
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*(#|$)/.test(line)) continue;
      const depth = line.length - line.trimStart().length;
      if (depth === 0) {
        inside = /^services\s*:\s*$/.test(line);
        indent = null;
        continue;
      }
      if (!inside) continue;
      indent ??= depth;
      const key = depth === indent ? /^\s*([\w.-]+)\s*:/.exec(line)?.[1] : undefined;
      if (key) services.push(key);
    }
    return services;
  }
  return [];
}
