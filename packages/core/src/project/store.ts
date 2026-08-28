/**
 * Project store.
 *
 * A project is a NAMED entity, created by the user, that carries an
 * ORDERED SET of roots. It's what defines what the model can see; the
 * conversation, meanwhile, defines how a turn executes (model, sampling,
 * permissions). This dividing line is taken from the Codex app, the only
 * comparable desktop application — its own CLI does it differently
 * because it has a current directory, which we don't.
 *
 * The order of the roots is SEMANTIC: the first is the default for
 * relative paths (see `resolveInPerimeter`). Reordering therefore changes
 * behavior, and must be announced to the model as a perimeter delta.
 *
 * A project with no root is legal: it's simply a group of conversations.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Project {
  id: string;
  name: string;
  /** Absolute roots, ORDERED. The first is the default for relatives. */
  roots: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectOptions {
  name: string;
  roots?: string[];
}

interface ProjectsFile {
  version: number;
  projects: Project[];
}

const VERSION = 1;

/** Makes absolute and deduplicates keeping the first one seen — the order is meaningful. */
function normalizeRoots(roots: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots ?? []) {
    const absolute = resolve(root);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push(absolute);
  }
  return out;
}

export class ProjectStore {
  constructor(readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'projects.json');
  }

  /**
   * A missing or unreadable file returns an EMPTY list rather than
   * throwing: the app must start and let the user fix things, not refuse
   * to open over a truncated JSON.
   */
  private async read(): Promise<ProjectsFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as ProjectsFile;
      if (!Array.isArray(parsed.projects)) return { version: VERSION, projects: [] };
      return parsed;
    } catch {
      return { version: VERSION, projects: [] };
    }
  }

  /** Atomic write: a temp file then a rename. */
  private async write(data: ProjectsFile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await rename(temp, this.file);
  }

  async list(): Promise<Project[]> {
    return (await this.read()).projects;
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.read()).projects.find((p) => p.id === id);
  }

  async create(options: CreateProjectOptions): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: options.name,
      roots: normalizeRoots(options.roots),
      createdAt: now,
      updatedAt: now,
    };
    const data = await this.read();
    data.projects.push(project);
    await this.write({ version: VERSION, projects: data.projects });
    return project;
  }

  private async mutate(
    id: string,
    change: (project: Project) => void,
  ): Promise<Project> {
    const data = await this.read();
    const project = data.projects.find((p) => p.id === id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    change(project);
    project.updatedAt = new Date().toISOString();
    await this.write({ version: VERSION, projects: data.projects });
    return project;
  }

  async rename(id: string, name: string): Promise<Project> {
    return this.mutate(id, (p) => {
      p.name = name;
    });
  }

  async setRoots(id: string, roots: string[]): Promise<Project> {
    return this.mutate(id, (p) => {
      p.roots = normalizeRoots(roots);
    });
  }

  async remove(id: string): Promise<void> {
    const data = await this.read();
    await this.write({
      version: VERSION,
      projects: data.projects.filter((p) => p.id !== id),
    });
  }
}
