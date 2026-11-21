/**
 * The contract of a plugin: its manifest, read and shown before anything of
 * it runs, and the context its Node half is given — the one way it reaches
 * the machine. The core's plugin host implements it; the SDK re-exports it
 * for plugin authors.
 *
 * - A plugin says what it will be able to do (`effects`) before it is
 *   activated, and a tool cannot do more than its plugin says (rule 8): a
 *   tool that writes in a plugin that only reads is refused at the manifest.
 * - A plugin never undoes its registrations by hand: everything goes through
 *   its context, which the host tears down as one.
 * - What a plugin's tool is given follows its declared effect: a tool that
 *   reads gets nothing to write with.
 */

import { z } from 'zod';
import type { Locale } from './ipc/app.js';
import type { ToolEffect } from './modes.js';

/** A label in English, optionally in French too; a plain string is English. */
export type LocalizedText = string | { en: string; fr?: string };

const localizedText = (max: number) =>
  z.union([z.string().min(1).max(max), z.object({ en: z.string().min(1).max(max), fr: z.string().min(1).max(max).optional() }).strict()]);

export function localize(text: LocalizedText, locale: Locale): string {
  return typeof text === 'string' ? text : (text[locale] ?? text.en);
}

/** What a plugin can declare doing. `ui` is not one: what only the window runs is not a tool of the core. */
export const PLUGIN_EFFECTS = ['read', 'write', 'execute', 'network'] as const;
export type PluginEffect = (typeof PLUGIN_EFFECTS)[number];
const pluginEffect = z.enum(PLUGIN_EFFECTS);

const effectSchema = z
  .object({
    effect: pluginEffect,
    /** What, said to the person before activation: « les fichiers du projet », « gh pr view ». */
    what: localizedText(160),
  })
  .strict();

const toolSchema = z
  .object({
    name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
    /** Sent to the model: English. */
    description: z.string().min(1).max(400),
    effect: pluginEffect,
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    /** Kept for the conversations told of it before, never told to a new one (a tool another replaced). */
    hidden: z.boolean().optional(),
    /** What a discussion is told of it instead — it has no folder (review of round 3, 6 and 7). Sent to the model: English. */
    discussion: z
      .object({ description: z.string().min(1).max(400), inputSchema: z.record(z.string(), z.unknown()).optional() })
      .strict()
      .optional(),
  })
  .strict();

const paneSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
    title: localizedText(48),
    /** Several at once (the terminal's tabs). */
    multiple: z.boolean().default(false),
    shortcut: z.string().max(24).optional(),
  })
  .strict();

const settingSchema = z
  .object({
    key: z.string().min(1).max(64),
    label: localizedText(80),
    type: z.enum(['string', 'number', 'boolean', 'select']),
    options: z.array(z.object({ value: z.string(), label: localizedText(80) }).strict()).optional(),
    description: localizedText(240).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict();

const commandSchema = z
  .object({
    /** Typed after « / »: a plain name. */
    name: z.string().min(1).max(32).regex(/^[a-z][a-z0-9-]*$/),
    /** Shown beside it in the menu. */
    description: localizedText(120),
  })
  .strict();

export const pluginManifestSchema = z
  .object({
    id: z.string().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
    name: localizedText(64),
    version: z.string().min(1).max(32),
    description: localizedText(240).optional(),
    /** The files of its halves, relative to its folder. */
    entry: z.object({ node: z.string().min(1).optional(), view: z.string().min(1).optional() }).strict().default({}),
    /** What it will be able to do, said before it is activated. */
    effects: z.array(effectSchema).default([]),
    contributes: z
      .object({
        tools: z.array(toolSchema).default([]),
        panes: z.array(paneSchema).default([]),
        settings: z.array(settingSchema).default([]),
        /** « / » commands: run, they call the command of the same name its Node half registers. */
        commands: z.array(commandSchema).default([]),
      })
      .strict()
      .default({ tools: [], panes: [], settings: [], commands: [] }),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const declared = new Set(manifest.effects.map((one) => one.effect));
    manifest.contributes.tools.forEach((tool, index) => {
      if (!declared.has(tool.effect)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributes', 'tools', index, 'effect'],
          message: `The tool ${tool.name} has the effect ${tool.effect}, which the plugin does not declare in its effects.`,
        });
      }
    });
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
/** A manifest as its author writes it: what has a default may be left out. */
export type PluginManifestInput = z.input<typeof pluginManifestSchema>;
export type PluginToolContribution = PluginManifest['contributes']['tools'][number];
export type PluginPaneContribution = PluginManifest['contributes']['panes'][number];
export type PluginSettingField = PluginManifest['contributes']['settings'][number];
export type PluginCommandContribution = PluginManifest['contributes']['commands'][number];

/**
 * Where a plugin came from (task 11.1): a folder copied, an npm package at the version it had when added, a git
 * repository at the commit it had, or a conversation that made it (task 11.4). An update is proposed against it,
 * never made in silence.
 */
export const pluginSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), path: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal('npm'), name: z.string().min(1).max(214), version: z.string().min(1).max(64) }).strict(),
  z
    .object({ kind: z.literal('git'), url: z.string().min(1).max(2048), ref: z.string().min(1).max(256), commit: z.string().regex(/^[0-9a-f]{7,64}$/) })
    .strict(),
  z.object({ kind: z.literal('conversation'), conversationId: z.string().min(1).max(128), title: z.string().max(256).optional() }).strict(),
]);
export type PluginSource = z.infer<typeof pluginSourceSchema>;

/** A manifest read, or why not — in words that say where. */
export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const error = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(manifest)'}: ${issue.message}`).join('; ');
  return { ok: false, error };
}

/** Where a plugin stands, for the window. */
export interface PluginStatus {
  id: string;
  name: LocalizedText;
  version: string;
  description?: LocalizedText;
  builtin: boolean;
  effects: PluginManifest['effects'];
  /** Switched on for the app — and, when a project is asked, for that project too. */
  enabled: boolean;
  active: boolean;
  /** Why its manifest or its activation failed. */
  error?: string;
  panes: PluginPaneContribution[];
  /** The names its tools have in the registry. */
  tools: string[];
  /** Where a plugin added came from (task 11.1); none for a built-in. */
  source?: PluginSource;
  /** A newer version found where it came from: proposed, never made in silence. */
  update?: string;
  /** The view of a plugin of a third party, served in its own frame (task 11.2). */
  view?: string;
  /** A plugin made in a conversation, tried there and there only (task 11.4): that conversation. */
  trial?: string;
  /** Its « / » commands, while it runs (task 11.4). */
  commands?: PluginCommandContribution[];
}

// ——— The context of the Node half ———

/** Aborted when the plugin is torn down: give it to whatever it starts. */
export interface PluginSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}

/** What one of the core's own tools gave back. */
export interface PluginToolUse {
  content: string;
  failed?: boolean;
}

/** One call of a plugin's tool. */
export interface PluginToolInvocation {
  input: Record<string, unknown>;
  conversationId: string;
  /** The perimeter of the conversation: its project's folders, or the home folder. */
  roots: readonly string[];
  signal: PluginSignal;
  /**
   * Run one of the core's own tools (`read_file`, `list_files`, `search`,
   * `edit_file`, `write_file`, `run_command`, `web_fetch`) in this call's
   * perimeter — only those the tool's declared effect covers: a tool that
   * reads may read, never write. A refusal is a result, never an exception.
   */
  use(tool: string, input: Record<string, unknown>): Promise<PluginToolUse>;
}

export interface PluginToolResult {
  content: string;
  failed?: boolean;
}

export type PluginToolHandler = (call: PluginToolInvocation) => Promise<PluginToolResult>;
export type PluginCommandHandler = (payload: unknown) => unknown;

/** A process a plugin started, through its context: killed with its children when the plugin goes. */
export interface PluginProcess {
  readonly pid: number | undefined;
  write(data: string): void;
  onOutput(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): Promise<void>;
}

/** A pseudo-terminal a plugin opened through its context: killed when the plugin goes. */
export interface PluginPty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
  /** Its output held while a view is behind — the shell itself stops at the next write it makes. */
  pause(): void;
  resume(): void;
}

export interface PluginPtyOptions {
  cwd?: string;
  cols: number;
  rows: number;
  /** Added to the app's own environment — from which the app takes its secrets out. */
  env?: Record<string, string>;
}

/** A shell of the machine, as the app found it: chosen by its id, never by a path. */
export interface PluginShell {
  id: string;
  label: string;
}

/**
 * The terminals the app gives: the shells it found on the machine (the
 * default first), and a pseudo-terminal opened on one of them — run in a
 * process of the app's own, never with its secrets.
 */
/** A page of results of a web search (task 10.4). */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Searching the web, as the app does it: the public engine read in a hidden page, or an online provider
 * whose key the app keeps — the app's choice, never the plugin's; no key ever reaches a plugin.
 */
export interface WebSearchService {
  search(query: string, max: number, signal?: PluginSignal): Promise<{ provider: string; results: WebSearchResult[] }>;
}

/** A line of a page's console (task 10.1). */
export interface BrowserConsoleLine {
  level: 'error' | 'warning' | 'info' | 'debug';
  text: string;
  source: string;
}

/** What the agent does in the built-in browser (task 10.1): on its conversation's own tab. */
export type BrowserAction = { kind: 'click'; selector: string } | { kind: 'type'; selector: string; text: string } | { kind: 'scroll'; by: number };

/**
 * Whose agent calls the browser (the browser redo, step 2): its conversation, whose own tab it works on, and the
 * project the core knows that conversation in — whose session (cookies, storage) the tab lives in; none: a session
 * in memory. Said by the core, never by a plugin.
 */
export interface BrowserCaller {
  conversationId: string;
  projectId?: string;
}

/**
 * The built-in browser, as the app gives it to a plugin that declares `network`: its pages live in the main
 * process, never with Node nor the window's bridge; this machine's own pages open, the network it is in does not.
 * Each conversation's agent has one tab of its own, in a session apart from the person's: it never sees, reads,
 * pictures nor acts on a tab of the person's (Paul, 2026-11-20).
 */
export interface BrowserService {
  /** Opened in the caller's own tab — the window shows that conversation's pane (the browser redo, step 1). */
  open(url: string, from: BrowserCaller): Promise<{ url: string; title: string } | { error: string }>;
  /**
   * A file of this machine, already checked by the core (`path` absolute, real, in the conversation's folders):
   * its page loads from `root`, the folder of the perimeter that holds it, and nothing else of the disk; it reaches
   * the network only with `network` — the conversation may go there without asking —, else it stays offline.
   */
  openFile(path: string, root: string, options: { network: boolean } & BrowserCaller): Promise<{ url: string; title: string } | { error: string }>;
  /** The text of the caller's page, and its console; null with no page open. The pane says « L'agent lit la page ». */
  read(from: BrowserCaller): Promise<{ url: string; title: string; text: string; console: BrowserConsoleLine[] } | null>;
  /** A picture of the caller's page, kept in the app's data folder (`saved`); null with no page open. */
  screenshot(from: BrowserCaller): Promise<{ url: string; width: number; height: number; saved: string } | null>;
  act(action: BrowserAction, from: BrowserCaller): Promise<{ done: string } | { error: string }>;
}

export interface TerminalService {
  shells(): readonly PluginShell[];
  open(shellId: string, options: PluginPtyOptions): PluginPty;
}

/** The events of one view of the plugin (a terminal's tab), pushed with back-pressure. */
export interface PluginInstanceChannel {
  /** False: the view is behind — stop until `onDrain`. */
  emit(event: string, payload: unknown): boolean;
  onDrain(listener: () => void): void;
  /** A new view of this instance: what was sent and never acknowledged is forgotten; its listeners stay. */
  reset(): void;
  dispose(): void;
}

export interface PluginNodeContext {
  readonly pluginId: string;
  /** Aborted at teardown. */
  readonly signal: PluginSignal;
  /** The handler of a tool its manifest declares. */
  registerToolHandler(name: string, handler: PluginToolHandler): void;
  /** What its view asks of it. */
  registerCommand(name: string, handler: PluginCommandHandler): void;
  getConfig<T = unknown>(key: string): T | undefined;
  /** The default channel (instance ''). */
  emit(event: string, payload: unknown): boolean;
  onDrain(listener: () => void): void;
  channel(instanceId: string): PluginInstanceChannel;
  /** Anything else it must undo, undone at teardown (last registered, first run). */
  onDispose(dispose: () => void | Promise<void>): void;
  log(message: string): void;
  /**
   * Start a program, hidden, with an argument array — never a shell string.
   * Only for a plugin that declares `execute`; the process and its children
   * are killed when the plugin goes.
   */
  spawn?(program: string, args: readonly string[], options?: { cwd?: string; env?: Record<string, string> }): PluginProcess;
  /**
   * The machine's shells, and a pseudo-terminal on one of them. Only for a
   * plugin that declares `execute`, and only where the app gives terminals;
   * a terminal is killed when the plugin goes.
   */
  terminals?: TerminalService;
  /**
   * Searching the web (task 10.4). Only for a plugin that declares `network`, and only where the app can
   * search; refused once the plugin is gone.
   */
  search?: WebSearchService['search'];
  /** The built-in browser (task 10.1). Only for a plugin that declares `network`, and only where the app has one. */
  browser?: PluginBrowser;
}

/**
 * The built-in browser as a plugin sees it: a file is named as the model named it, with the call it comes from (its
 * conversation and perimeter, the invocation's own) — the host checks it is a file there, and what the conversation
 * may, before anything opens. A file is read. Every call names its conversation, whose agent's tab it works on; the
 * host adds the project the core knows it in (the browser redo, step 2).
 */
export interface PluginBrowser {
  open(url: string, from: { conversationId: string }): Promise<{ url: string; title: string } | { error: string }>;
  openFile(
    path: string,
    from: { conversationId: string; roots: readonly string[] },
  ): Promise<{ url: string; title: string; offline?: boolean } | { error: string }>;
  read(from: { conversationId: string }): ReturnType<BrowserService['read']>;
  screenshot(from: { conversationId: string }): ReturnType<BrowserService['screenshot']>;
  act(action: BrowserAction, from: { conversationId: string }): ReturnType<BrowserService['act']>;
}

export interface PluginNodeModule {
  activate(context: PluginNodeContext): void | Promise<void>;
}

/** The effect a plugin tool's own effect lets it use among the core's tools. */
export function usableEffects(effect: PluginEffect): readonly ToolEffect[] {
  switch (effect) {
    case 'read':
      return ['read'];
    case 'write':
      return ['read', 'write'];
    case 'execute':
      return ['read', 'execute'];
    case 'network':
      // Never the project's files on the way out: a tool that sends does not read.
      return ['network'];
  }
}
