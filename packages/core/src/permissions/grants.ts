/**
 * The rules « always allow » remembered (audit 2026-11-21, D3), in
 * `<dir>/grants.json`: the app's (a site, and what a conversation without a
 * project allowed), each project's, and each conversation's own (« Pour
 * cette conversation »), forgotten with the conversation. Written whole and
 * atomically, one change at a time; read again through the same rule as when
 * they were remembered: a rule written by hand that could not have been
 * remembered is dropped. A missing or unreadable file is an empty store.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { isValidRule, sameRule, type AllowRule } from './rules.js';

/** Where a rule is kept, and so which conversations it answers for. */
export type GrantScope = { kind: 'app' } | { kind: 'project'; projectId: string } | { kind: 'conversation'; conversationId: string };

export interface Grant {
  scope: GrantScope;
  rule: AllowRule;
}

interface GrantsFile {
  version: 2;
  app: AllowRule[];
  projects: Record<string, AllowRule[]>;
  conversations: Record<string, AllowRule[]>;
}

function readRule(raw: unknown): AllowRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { tool, program, args, path, origin } = raw as Record<string, unknown>;
  if (typeof tool !== 'string') return null;
  for (const value of [program, path, origin]) if (value !== undefined && typeof value !== 'string') return null;
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) return null;
  const rule: AllowRule = {
    tool,
    ...(program !== undefined ? { program: program as string } : {}),
    ...(args !== undefined ? { args: args as string[] } : {}),
    ...(path !== undefined ? { path: path as string } : {}),
    ...(origin !== undefined ? { origin: origin as string } : {}),
  };
  return isValidRule(rule) ? rule : null;
}

function readList(raw: unknown): AllowRule[] {
  return Array.isArray(raw) ? raw.map(readRule).filter((rule): rule is AllowRule => rule !== null) : [];
}

function readBuckets(raw: unknown): Map<string, AllowRule[]> {
  const buckets = new Map<string, AllowRule[]>();
  if (typeof raw !== 'object' || raw === null) return buckets;
  for (const [key, rules] of Object.entries(raw)) {
    const kept = readList(rules);
    if (key !== '' && kept.length > 0) buckets.set(key, kept);
  }
  return buckets;
}

export class GrantStore {
  private app: AllowRule[] = [];
  private projects = new Map<string, AllowRule[]>();
  private conversations = new Map<string, AllowRule[]>();
  private readonly writes = new KeyedQueue();

  constructor(readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'grants.json');
  }

  async load(): Promise<void> {
    const raw = (await readJsonFile(this.file).catch(() => null)) as Partial<GrantsFile> & { projects?: Record<string, unknown> } | null;
    if (typeof raw !== 'object' || raw === null) {
      this.app = [];
      this.projects = new Map();
      this.conversations = new Map();
      return;
    }
    // A first version kept the conversations without a project under the key '': the app's now.
    const legacy = (raw.version as number | undefined) === 1 ? readList(raw.projects?.['']) : [];
    this.app = [...readList(raw.app), ...legacy.filter((rule) => !readList(raw.app).some((known) => sameRule(known, rule)))];
    this.projects = readBuckets(raw.projects);
    this.conversations = readBuckets(raw.conversations);
  }

  /** The rules that answer a conversation's calls: the app's, its project's, its own. */
  rulesFor(projectId: string | undefined, conversationId?: string): AllowRule[] {
    return [
      ...this.app,
      ...(projectId ? (this.projects.get(projectId) ?? []) : []),
      ...(conversationId ? (this.conversations.get(conversationId) ?? []) : []),
    ].map((rule) => ({ ...rule }));
  }

  /** The rules kept in one place. */
  list(scope: GrantScope): AllowRule[] {
    return this.bucket(scope).map((rule) => ({ ...rule }));
  }

  all(): Grant[] {
    return [
      ...this.app.map((rule): Grant => ({ scope: { kind: 'app' }, rule: { ...rule } })),
      ...[...this.projects.entries()].flatMap(([projectId, rules]) => rules.map((rule): Grant => ({ scope: { kind: 'project', projectId }, rule: { ...rule } }))),
      ...[...this.conversations.entries()].flatMap(([conversationId, rules]) =>
        rules.map((rule): Grant => ({ scope: { kind: 'conversation', conversationId }, rule: { ...rule } })),
      ),
    ];
  }

  add(scope: GrantScope, rule: AllowRule): Promise<void> {
    if (!isValidRule(rule)) {
      return Promise.reject(new Error('This rule cannot be remembered: a shell, a line that chains, pipes or substitutes, or a program without its exact arguments, always asks.'));
    }
    return this.change(() => {
      const rules = this.bucket(scope);
      if (!rules.some((known) => sameRule(known, rule))) this.setBucket(scope, [...rules, { ...rule }]);
    });
  }

  revoke(scope: GrantScope, rule: AllowRule): Promise<void> {
    return this.change(() => this.setBucket(scope, this.bucket(scope).filter((known) => !sameRule(known, rule))));
  }

  dropProject(projectId: string): Promise<void> {
    return this.change(() => this.projects.delete(projectId));
  }

  /** A conversation deleted or archived: what it alone allowed goes with it. */
  dropConversation(conversationId: string): Promise<void> {
    if (!this.conversations.has(conversationId)) return Promise.resolve();
    return this.change(() => this.conversations.delete(conversationId));
  }

  private bucket(scope: GrantScope): AllowRule[] {
    if (scope.kind === 'app') return this.app;
    if (scope.kind === 'project') return this.projects.get(scope.projectId) ?? [];
    return this.conversations.get(scope.conversationId) ?? [];
  }

  private setBucket(scope: GrantScope, rules: AllowRule[]): void {
    if (scope.kind === 'app') {
      this.app = rules;
      return;
    }
    const map = scope.kind === 'project' ? this.projects : this.conversations;
    const key = scope.kind === 'project' ? scope.projectId : scope.conversationId;
    if (rules.length > 0) map.set(key, rules);
    else map.delete(key);
  }

  /** One change at a time, the whole file written after each. */
  private change(apply: () => void): Promise<void> {
    return this.writes.run(this.file, async () => {
      apply();
      await mkdir(this.dir, { recursive: true });
      const file: GrantsFile = {
        version: 2,
        app: this.app,
        projects: Object.fromEntries(this.projects),
        conversations: Object.fromEntries(this.conversations),
      };
      await writeJsonFile(this.file, file);
    });
  }
}
