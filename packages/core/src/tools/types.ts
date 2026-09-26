/**
 * Agent tool contract. A tool = a schema (JSON Schema) + a pure Node
 * handler. Tools come from the core, from plugins, or from MCP: the
 * registry merges them, and the grammar is derived from that.
 */

export type ToolSource = 'builtin' | 'plugin' | 'mcp';

/**
 * What the tool does — arbitrated by the permission engine. `network`:
 * something leaves the machine (a search query, a fetched URL), which a
 * `read` never does (Q-23).
 */
export type ToolEffect = 'read' | 'write' | 'execute' | 'network';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  inputSchema: Record<string, unknown>;
  effect: ToolEffect;
}

export interface ToolContext {
  /**
   * Roots of the open project, ORDERED: the first is the default for
   * relative paths, and the allowed perimeter is their UNION.
   *
   * EMPTY is a normal case: the tools still exist, the project is not
   * their condition of existence but their PERIMETER. With no root, the
   * perimeter is the home folder, and relative paths start from it.
   */
  roots: string[];
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Text reinjected to the model (already truncated if needed). */
  content: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface RegisteredTool {
  def: ToolDef;
  handler: ToolHandler;
  source: ToolSource;
}

/** Snapshot of the inventory, to detect changes between two turns. */
export interface ToolInventorySnapshot {
  names: string[];
  /** Stable fingerprint (names + schemas): changes ⇔ the inventory changed. */
  hash: string;
}

export interface ToolInventoryDelta {
  added: ToolDef[];
  removed: string[];
}
