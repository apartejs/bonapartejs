/**
 * Single tool registry: core + plugins + MCP. It's what produces the
 * grammar (i.e. what the model can literally emit) and the inventory
 * deltas appended to the log when the tooling changes mid-conversation —
 * never a re-render of the history.
 */

import { createHash } from 'node:crypto';
import { buildGrammarConstraint, type GrammarConstraint } from './grammar.js';
import type {
  RegisteredTool,
  ToolDef,
  ToolHandler,
  ToolInventoryDelta,
  ToolInventorySnapshot,
  ToolSource,
} from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly listeners = new Set<(delta: ToolInventoryDelta) => void>();

  register(def: ToolDef, handler: ToolHandler, source: ToolSource = 'builtin'): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, { def, handler, source });
    this.emit({ added: [def], removed: [] });
  }

  unregister(name: string): void {
    if (!this.tools.delete(name)) return;
    this.emit({ added: [], removed: [name] });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()]
      .map((t) => t.def)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(): ToolInventorySnapshot {
    const defs = this.list();
    // The fingerprint covers name + description + schema: two identical
    // inventories registered in a different order give the same hash.
    const material = JSON.stringify(
      defs.map((d) => [d.name, d.description, d.effect, d.inputSchema]),
    );
    return {
      names: defs.map((d) => d.name),
      hash: createHash('sha256').update(material).digest('hex'),
    };
  }

  /** What changed since a snapshot (added carries the definitions). */
  diff(previous: ToolInventorySnapshot): ToolInventoryDelta {
    const before = new Set(previous.names);
    const current = this.list();
    const currentNames = new Set(current.map((d) => d.name));
    return {
      added: current.filter((d) => !before.has(d.name)),
      removed: previous.names.filter((name) => !currentNames.has(name)),
    };
  }

  grammar(): GrammarConstraint | null {
    return buildGrammarConstraint(this.list());
  }

  onChange(listener: (delta: ToolInventoryDelta) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(delta: ToolInventoryDelta): void {
    for (const listener of this.listeners) listener(delta);
  }
}
