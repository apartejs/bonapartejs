/**
 * What a tool is, and what it gives back. The registry, the permissions and
 * the agent loop arrive in phase 4; the family layers need these shapes now,
 * to tell the model about the tools and to render their results.
 */

import type { ToolEffect } from '@aparte/bonaparte-shared';

export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  /** Sent to the model: English. */
  description: string;
  inputSchema: JsonSchema;
  effect: ToolEffect;
  source: 'builtin' | 'plugin' | 'mcp' | 'extension';
  /** Where it runs: in the core, or in the window (`ask_user`). */
  where: 'core' | 'window';
}

export interface ToolResult {
  toolCallId: string;
  /** The tool's name: the model reads which call a result answers. */
  name: string;
  /** Sent to the model: English for what the harness writes. */
  content: string;
  structuredContent?: unknown;
  failed?: boolean;
}
