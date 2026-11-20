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
  /** Kept for the conversations told of it before, never told to a new one (`browser_open_file`). */
  hidden?: true;
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

/** A call the model made: its id, the tool, what it gave. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** What a tool runs in: its conversation (whose writes pass one at a time), its folders, the context it is cut to. */
export interface ToolContext {
  conversationId: string;
  /** The perimeter: the project's folders, or the home folder without a project. */
  roots: readonly string[];
  /** The engine's context: what the output is cut to. */
  nCtx: number;
  signal: AbortSignal;
  /** The person allowed this very call although it lands outside the project's folders: a write goes there. */
  granted?: boolean;
  /** Before a tool writes a file: its original is kept for the turn (checkpoints). */
  beforeWrite?(absolute: string, shown: string): Promise<void>;
  /** After it wrote it. */
  afterWrite?(absolute: string): Promise<void>;
  /** What a command prints, as it prints it: the terminal's agent tab shows it. */
  onOutput?(event: CommandOutputEvent): void;
}

/** A command the agent runs, told as it runs. */
export type CommandOutputEvent =
  | { kind: 'start'; command: string; cwd: string }
  | { kind: 'data'; text: string }
  | { kind: 'exit'; code: number | null };

/** What a tool gives back; the registry adds the call it answers. */
export interface ToolOutput {
  content: string;
  structuredContent?: unknown;
  failed?: boolean;
}

export type ToolHandler = (call: ToolCall, ctx: ToolContext) => Promise<ToolOutput>;
