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
      })
      .strict()
      .default({ tools: [], panes: [], settings: [] }),
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

/** The events of one view of the plugin (a terminal's tab), pushed with back-pressure. */
export interface PluginInstanceChannel {
  /** False: the view is behind — stop until `onDrain`. */
  emit(event: string, payload: unknown): boolean;
  onDrain(listener: () => void): void;
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
