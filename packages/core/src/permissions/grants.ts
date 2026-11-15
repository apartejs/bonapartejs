/**
 * The rules « always allow » remembered, per project — and for the
 * conversations without one — in `<dir>/grants.json`. Written whole and
 * atomically, one change at a time; read again through the same rule as
 * when they were remembered: a rule written by hand that could not have been
 * remembered is dropped. A missing or unreadable file is an empty store.
 */

import { join } from 'node:path';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { isValidRule, type AllowRule } from './rules.js';

export interface Grant {
  projectId: string | undefined;
  rule: AllowRule;
}

interface GrantsFile {
  version: 1;
  projects: Record<string, AllowRule[]>;
}

/** The bucket of the conversations without a project. */
const NO_PROJECT = '';

function keyOf(projectId: string | undefined): string {
  return projectId ?? NO_PROJECT;
}

function sameRule(a: AllowRule, b: AllowRule): boolean {
  return (
    a.tool === b.tool &&
    a.program === b.program &&
    (a.args === undefined) === (b.args === undefined) &&
    (a.args ?? []).length === (b.args ?? []).length &&
    (a.args ?? []).every((arg, index) => arg === b.args?.[index])
  );
}

function readRule(raw: unknown): AllowRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { tool, program, args } = raw as Record<string, unknown>;
  if (typeof tool !== 'string') return null;
  if (program !== undefined && typeof program !== 'string') return null;
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) return null;
  const rule: AllowRule = {
    tool,
    ...(program !== undefined ? { program } : {}),
    ...(args !== undefined ? { args: args as string[] } : {}),
  };
  return isValidRule(rule) ? rule : null;
}

export class GrantStore {
  private projects = new Map<string, AllowRule[]>();
  private readonly writes = new KeyedQueue();

  constructor(readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'grants.json');
  }

  async load(): Promise<void> {
    const raw = await readJsonFile(this.file).catch(() => null);
    const projects = new Map<string, AllowRule[]>();
    const listed = typeof raw === 'object' && raw !== null ? (raw as Partial<GrantsFile>).projects : undefined;
    if (typeof listed === 'object' && listed !== null) {
      for (const [key, rules] of Object.entries(listed)) {
        if (!Array.isArray(rules)) continue;
        const kept = rules.map(readRule).filter((rule): rule is AllowRule => rule !== null);
        if (kept.length > 0) projects.set(key, kept);
      }
    }
    this.projects = projects;
  }

  rulesFor(projectId: string | undefined): AllowRule[] {
    return (this.projects.get(keyOf(projectId)) ?? []).map((rule) => ({ ...rule }));
  }

  all(): Grant[] {
    return [...this.projects.entries()].flatMap(([key, rules]) =>
      rules.map((rule) => ({ projectId: key === NO_PROJECT ? undefined : key, rule: { ...rule } })),
    );
  }

  add(projectId: string | undefined, rule: AllowRule): Promise<void> {
    if (!isValidRule(rule)) {
      return Promise.reject(new Error('This rule cannot be remembered: a shell, or a line that chains, pipes or substitutes, always asks.'));
    }
    return this.change(() => {
      const rules = this.projects.get(keyOf(projectId)) ?? [];
      if (!rules.some((known) => sameRule(known, rule))) this.projects.set(keyOf(projectId), [...rules, { ...rule }]);
    });
  }

  revoke(projectId: string | undefined, rule: AllowRule): Promise<void> {
    return this.change(() => {
      const rules = (this.projects.get(keyOf(projectId)) ?? []).filter((known) => !sameRule(known, rule));
      if (rules.length > 0) this.projects.set(keyOf(projectId), rules);
      else this.projects.delete(keyOf(projectId));
    });
  }

  dropProject(projectId: string): Promise<void> {
    return this.change(() => {
      this.projects.delete(keyOf(projectId));
    });
  }

  /** One change at a time, the whole file written after each. */
  private change(apply: () => void): Promise<void> {
    return this.writes.run(this.file, async () => {
      apply();
      const file: GrantsFile = { version: 1, projects: Object.fromEntries(this.projects) };
      await writeJsonFile(this.file, file);
    });
  }
}
