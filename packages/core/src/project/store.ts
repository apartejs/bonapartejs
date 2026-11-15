/**
 * The projects, in `<dir>/projects.json`: a name, folders — absolute, once
 * each, in order (the first is where a relative path is read from) — and the
 * mode a new conversation starts in. A folder on the network is never one.
 * One change at a time, the whole file written atomically; a missing or
 * unreadable file is no project, not a refusal to start.
 */

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { NetworkPathError } from './paths.js';

export interface Project {
  id: string;
  name: string;
  roots: string[];
  defaultMode: PlayMode;
  /** What the project adds to the files always asked (« Dockerfile »). */
  alwaysAsk?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NewProject {
  name: string;
  roots?: readonly string[];
  defaultMode?: PlayMode;
}

export type ProjectChanges = Partial<Pick<Project, 'name' | 'defaultMode'>> & { roots?: readonly string[]; alwaysAsk?: readonly string[] };

interface ProjectsFile {
  version: 1;
  projects: Project[];
}

const MODES = new Set<string>(['lecture', 'repetition', 'plume', 'impro']);

function normalizeRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const root of roots) {
    if (/^[\\/]{2}/.test(root)) throw new NetworkPathError(root);
    const absolute = resolve(root);
    if (/^[\\/]{2}/.test(absolute)) throw new NetworkPathError(root);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(absolute);
  }
  return kept;
}

function readProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const project = raw as Partial<Project>;
  if (typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.roots)) return null;
  return {
    id: project.id,
    name: project.name,
    roots: project.roots.filter((root): root is string => typeof root === 'string' && !/^[\\/]{2}/.test(root)),
    defaultMode: MODES.has(String(project.defaultMode)) ? (project.defaultMode as PlayMode) : 'repetition',
    // What the project adds to « toujours demandé »: kept through every read, or the protection goes.
    ...(Array.isArray(project.alwaysAsk) ? { alwaysAsk: project.alwaysAsk.filter((name): name is string => typeof name === 'string') } : {}),
    createdAt: typeof project.createdAt === 'string' ? project.createdAt : new Date(0).toISOString(),
    updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : new Date(0).toISOString(),
  };
}

export class ProjectStore {
  private readonly writes = new KeyedQueue();

  constructor(readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'projects.json');
  }

  async list(): Promise<Project[]> {
    const raw = await readJsonFile(this.file).catch(() => null);
    const listed = typeof raw === 'object' && raw !== null ? (raw as Partial<ProjectsFile>).projects : undefined;
    return Array.isArray(listed) ? listed.map(readProject).filter((project): project is Project => project !== null) : [];
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.list()).find((project) => project.id === id);
  }

  async create(input: NewProject): Promise<Project> {
    const roots = normalizeRoots(input.roots ?? []);
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      roots,
      defaultMode: input.defaultMode ?? 'repetition',
      createdAt: now,
      updatedAt: now,
    };
    await this.mutate((projects) => [...projects, project]);
    return project;
  }

  async update(id: string, changes: ProjectChanges): Promise<Project> {
    const roots = changes.roots === undefined ? undefined : normalizeRoots(changes.roots);
    let changed: Project | undefined;
    await this.mutate((projects) => {
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) throw new Error(`Unknown project: ${id}`);
      changed = {
        ...projects[index]!,
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.defaultMode !== undefined ? { defaultMode: changes.defaultMode } : {}),
        ...(roots !== undefined ? { roots } : {}),
        ...(changes.alwaysAsk !== undefined ? { alwaysAsk: [...new Set(changes.alwaysAsk.map((name) => name.trim()).filter(Boolean))] } : {}),
        updatedAt: new Date().toISOString(),
      };
      return projects.map((project, at) => (at === index ? changed! : project));
    });
    return changed!;
  }

  remove(id: string): Promise<void> {
    return this.mutate((projects) => projects.filter((project) => project.id !== id));
  }

  /** Read, change, write — one at a time. */
  private mutate(change: (projects: Project[]) => Project[]): Promise<void> {
    return this.writes.run(this.file, async () => {
      const file: ProjectsFile = { version: 1, projects: change(await this.list()) };
      // The data folder of a fresh install is made by its first write.
      await mkdir(this.dir, { recursive: true });
      await writeJsonFile(this.file, file);
    });
  }
}
