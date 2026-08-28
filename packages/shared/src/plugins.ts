/**
 * Plugin contract — DECLARATIVE manifest (VS Code's `contributes` model).
 *
 * The manifest is read and validated WITHOUT executing a single line of the
 * plugin: that's what allows displaying the plugin list, detecting an id
 * conflict or a duplicate view before any activation, and cleanly rejecting
 * a broken plugin instead of crashing the app on load.
 */

import { z } from 'zod';
import type { BonaparteLocale } from './locale.js';

/** Identifier: lowercase letters, digits and hyphens — it serves as the folder name. */
const pluginId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'id: lowercase letters, digits and hyphens, starting with a letter');

/**
 * A label shown to the user — a tab title, a plugin name. Visible strings
 * follow the UI rule (fr/en), so a manifest may give both forms; English is
 * the required one, the wire language and the fallback. A plain string is
 * still accepted: it is displayed as is, whatever the locale.
 */
function localizedLabel(max: number) {
  const text = z.string().min(1).max(max);
  return z.union([text, z.object({ en: text, fr: text.optional() })]);
}

export type LocalizedText = string | { en: string; fr?: string };

/** Resolves a manifest label for a locale, falling back to English. */
export function localize(text: LocalizedText, locale: BonaparteLocale): string {
  if (typeof text === 'string') return text;
  return text[locale] ?? text.en;
}

/**
 * A view mounted in the tooling panel (on the right). Each view is
 * sovereign over its content: the panel only provides the tab and the space.
 */
export const toolingViewSchema = z.object({
  id: z.string().min(1).max(64),
  /** Tab title, in one or both locales. */
  title: localizedLabel(48),
  /** Short glyph shown in the tab — one or two characters. */
  icon: z.string().max(4).optional(),
  /** Indicative order in the open menu; falls back to discovery order. */
  order: z.number().int().optional(),
  /**
   * Several simultaneous instances allowed.
   *
   * Two terminals or two pages make sense: they're two sessions. Two times
   * the conversation's settings, no — the second one would have nothing more
   * to show. The default is therefore `false`: a view opens as a single
   * instance until it has said otherwise.
   */
  multiple: z.boolean().default(false),
  /** Suggested shortcut, shown in the open menu (e.g. "Ctrl+T"). */
  shortcut: z.string().max(24).optional(),
});

/** A tool that the plugin adds to the agent's inventory. */
export const agentToolContributionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'tool name: lowercase letters and underscores'),
  description: z.string().min(1).max(400),
  /** Dominant effect — drives the permissions engine. */
  effect: z.enum(['read', 'write', 'execute']),
  /**
   * JSON schema of the arguments. It is NOT decorative: the tool-call
   * grammar is derived from it, so a tool without a schema is a tool
   * the model can only call with an empty object.
   */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

/** A setting exposed by the plugin in the Settings hub. */
export const configFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: localizedLabel(80),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  /** For `select` only. */
  options: z.array(z.object({ value: z.string(), label: localizedLabel(80) })).optional(),
  description: localizedLabel(240).optional(),
  /** A field read as a secret (an API key): shown masked in the hub. */
  secret: z.boolean().optional(),
  /**
   * Show this field only when sibling settings hold one of the given values:
   * `{ provider: ['brave', 'tavily'] }` shows the key only for online providers.
   * The keys are the OTHER fields' own keys (unqualified).
   */
  showFor: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Scopes where the setting is editable. A global-only setting doesn't
   * appear in a conversation's settings, and vice versa.
   */
  scopes: z.array(z.enum(['global', 'conversation'])).min(1),
  /**
   * The value in force when the user has set nothing — the one the hub
   * shows as inherited. Without it a select shows an empty choice while the
   * plugin's Node half quietly applies its own fallback.
   */
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const pluginManifestSchema = z.object({
  id: pluginId,
  name: localizedLabel(64),
  version: z.string().min(1).max(32),
  description: localizedLabel(240).optional(),
  /**
   * Entry points. `node` runs in the main process (tools, backends);
   * `renderer` is lazily imported when a view is displayed.
   */
  entry: z
    .object({
      node: z.string().min(1).optional(),
      renderer: z.string().min(1).optional(),
    })
    .default({}),
  contributes: z
    .object({
      toolingViews: z.array(toolingViewSchema).default([]),
      agentTools: z.array(agentToolContributionSchema).default([]),
      configSchemas: z.array(configFieldSchema).default([]),
    })
    .default({ toolingViews: [], agentTools: [], configSchemas: [] }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type ToolingViewContribution = z.infer<typeof toolingViewSchema>;
export type AgentToolContribution = z.infer<typeof agentToolContributionSchema>;
export type PluginConfigField = z.infer<typeof configFieldSchema>;

/** State of a plugin as the UI sees it. */
export interface PluginStatusDto {
  id: string;
  name: LocalizedText;
  version: string;
  description?: LocalizedText;
  enabled: boolean;
  active: boolean;
  /** Set when the manifest is invalid or activation has failed. */
  error?: string;
  views: ToolingViewContribution[];
  toolNames: string[];
  /** The plugin's global settings, as declared — shown in the hub under its name. */
  configSchemas: PluginConfigField[];
}
