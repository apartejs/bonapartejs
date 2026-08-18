/**
 * Inventaire des modèles GGUF — le modèle n'est PAS un paramètre du backend :
 * c'est une propriété de la conversation, choisie depuis cet inventaire.
 * Scan des emplacements connus (LM Studio, cache Hugging Face) + répertoires
 * custom ; le scan disque profond opt-in viendra plus tard (plan v1).
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type ModelSource = 'lmstudio' | 'hf-cache' | 'custom' | 'manual';

export interface DiscoveredModel {
  /** Chemin absolu du fichier .gguf. */
  path: string;
  /** Nom lisible (nom de fichier sans extension). */
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: ModelSource;
}

export interface ScanRoot {
  dir: string;
  source: ModelSource;
}

/** Emplacements connus, selon la plateforme (les absents sont ignorés au scan). */
export function defaultScanRoots(): ScanRoot[] {
  const home = homedir();
  return [
    { dir: join(home, '.lmstudio', 'models'), source: 'lmstudio' },
    { dir: join(home, '.cache', 'lm-studio', 'models'), source: 'lmstudio' },
    { dir: join(home, '.cache', 'huggingface'), source: 'hf-cache' },
  ];
}

export interface ScanOptions {
  /** Profondeur max de récursion (défaut 4). */
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
      return; // racine absente ou illisible : ignorée
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
        // fichier disparu entre readdir et stat : ignoré
      }
    }
  }

  for (const root of roots) {
    await walk(root.dir, root.source, 0);
  }

  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}
