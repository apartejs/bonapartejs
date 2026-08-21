/**
 * Magasin des projets.
 *
 * Un projet est une entité NOMMÉE, créée par l'utilisateur, qui porte un
 * ENSEMBLE ORDONNÉ de racines. C'est lui qui définit ce que le modèle peut
 * voir ; la conversation, elle, définit comment un tour s'exécute (modèle,
 * échantillonnage, permissions). Cette ligne de partage est reprise de l'app
 * Codex, seule application de bureau comparable — sa propre CLI fait autrement
 * parce qu'elle a un répertoire courant, ce que nous n'avons pas.
 *
 * L'ordre des racines est SÉMANTIQUE : la première est le défaut des chemins
 * relatifs (voir `resolveInPerimeter`). Réordonner change donc le comportement,
 * et doit être annoncé au modèle comme un delta de périmètre.
 *
 * Un projet sans racine est légal : c'est un simple groupe de conversations.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Project {
  id: string;
  name: string;
  /** Racines absolues, ORDONNÉES. La première est le défaut des relatifs. */
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

/** Absolutise et déduplique en gardant le premier venu — l'ordre est porteur. */
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
   * Un fichier absent ou illisible rend une liste VIDE plutôt que de lever :
   * l'app doit démarrer et laisser l'utilisateur réparer, pas refuser de
   * s'ouvrir sur un JSON tronqué.
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

  /** Écriture atomique : un fichier temporaire puis un renommage. */
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
    if (!project) throw new Error(`Projet inconnu : ${id}`);
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
