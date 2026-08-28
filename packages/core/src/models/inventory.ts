/**
 * GGUF model inventory — the model is NOT a backend parameter: it's a
 * property of the conversation, chosen from this inventory. Scans known
 * locations (LM Studio, Hugging Face cache) + custom directories; deep
 * opt-in disk scanning will come later (v1 plan).
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type ModelSource = 'lmstudio' | 'hf-cache' | 'custom' | 'manual';

export interface DiscoveredModel {
  /** Absolute path of the .gguf file. */
  path: string;
  /** Readable name (filename without extension). */
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: ModelSource;
}

export interface ScanRoot {
  dir: string;
  source: ModelSource;
}

/** Known locations, depending on the platform (absent ones are ignored when scanning). */
export function defaultScanRoots(): ScanRoot[] {
  const home = homedir();
  return [
    { dir: join(home, '.lmstudio', 'models'), source: 'lmstudio' },
    { dir: join(home, '.cache', 'lm-studio', 'models'), source: 'lmstudio' },
    { dir: join(home, '.cache', 'huggingface'), source: 'hf-cache' },
  ];
}

export interface ScanOptions {
  /** Max recursion depth (default 4). */
  maxDepth?: number;
}

export async function scanModels(
  roots: ScanRoot[],
  options: ScanOptions = {},
): Promise<DiscoveredModel[]> {
  const maxDepth = options.maxDepth ?? 4;
  const byPath = new Map<string, DiscoveredModel>();

  async function walk(dir: string, source: ModelSource, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // root absent or unreadable: ignored
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(path, source, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
      const resolved = resolve(path);
      if (byPath.has(resolved)) continue;
      try {
        const stats = await stat(resolved);
        byPath.set(resolved, {
          path: resolved,
          name: entry.name.replace(/\.gguf$/i, ''),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          source,
        });
      } catch {
        // file disappeared between readdir and stat: ignored
      }
    }
  }

  for (const root of roots) {
    await walk(root.dir, root.source, 0);
  }

  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}
