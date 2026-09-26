/**
 * GrantStore — what "always allow" granted, remembered per project, on
 * disk (P1.8, D-29). A grant given in one project never answers for
 * another; a restart keeps it; the hub lists and revokes it. A
 * conversation without a project has its own bucket.
 *
 * The file is `grants.json` in the config folder. It is read once
 * (`load`) and kept in memory: the permission engine asks for the rules of
 * the conversation's project on every tool call, synchronously.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AllowRule } from './engine.js';

/** Key of the bucket for conversations without a project. */
const NO_PROJECT = '';

interface GrantsFile {
  version: 1;
  projects: Record<string, AllowRule[]>;
}

export interface Grant {
  /** Absent: a conversation without a project. */
  projectId: string | undefined;
  rule: AllowRule;
}

function isRule(value: unknown): value is AllowRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule['tool'] === 'string' &&
    (rule['commandPrefix'] === undefined || typeof rule['commandPrefix'] === 'string') &&
    (rule['exactCommand'] === undefined || typeof rule['exactCommand'] === 'string')
  );
}

function clean(rule: AllowRule): AllowRule {
  return {
    tool: rule.tool,
    ...(rule.commandPrefix !== undefined ? { commandPrefix: rule.commandPrefix } : {}),
    ...(rule.exactCommand !== undefined ? { exactCommand: rule.exactCommand } : {}),
  };
}

function same(a: AllowRule, b: AllowRule): boolean {
  return a.tool === b.tool && a.commandPrefix === b.commandPrefix && a.exactCommand === b.exactCommand;
}

export class GrantStore {
  private projects: Record<string, AllowRule[]> = {};

  constructor(readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'grants.json');
  }

  /** Reads the file; a missing or corrupted one is an empty store, a malformed rule is dropped. */
  async load(): Promise<void> {
    this.projects = {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return;
    }
    const projects = (parsed as Partial<GrantsFile> | null)?.projects;
    if (typeof projects !== 'object' || projects === null) return;
    for (const [key, rules] of Object.entries(projects)) {
      if (!Array.isArray(rules)) continue;
      const kept = rules.filter(isRule).map(clean);
      if (kept.length > 0) this.projects[key] = kept;
    }
  }

  rulesFor(projectId: string | undefined): AllowRule[] {
    return (this.projects[projectId ?? NO_PROJECT] ?? []).map((rule) => ({ ...rule }));
  }

  all(): Grant[] {
    return Object.entries(this.projects).flatMap(([key, rules]) =>
      rules.map((rule) => ({ projectId: key === NO_PROJECT ? undefined : key, rule: { ...rule } })),
    );
  }

  async add(projectId: string | undefined, rule: AllowRule): Promise<void> {
    const key = projectId ?? NO_PROJECT;
    const rules = this.projects[key] ?? [];
    if (rules.some((existing) => same(existing, rule))) return;
    this.projects[key] = [...rules, clean(rule)];
    await this.save();
  }

  async revoke(projectId: string | undefined, rule: AllowRule): Promise<void> {
    const key = projectId ?? NO_PROJECT;
    const rules = (this.projects[key] ?? []).filter((existing) => !same(existing, rule));
    if (rules.length > 0) this.projects[key] = rules;
    else delete this.projects[key];
    await this.save();
  }

  /** A project deleted: its grants go with it. */
  async dropProject(projectId: string): Promise<void> {
    if (!(projectId in this.projects)) return;
    delete this.projects[projectId];
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const data: GrantsFile = { version: 1, projects: this.projects };
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await rename(temp, this.file);
  }
}
