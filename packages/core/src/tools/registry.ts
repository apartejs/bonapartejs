/**
 * The one registry of tools, in the core: what the model is told of, and the
 * one way a tool runs.
 *
 * - The inventory has a fingerprint that does not depend on the order of
 *   registration; a change is a delta (the tools added, whole; the names
 *   taken back), appended to the prompt — never a re-render of it.
 * - `run` is the only path to a handler. The tools that write or run
 *   something pass one at a time per conversation, in the order they started
 *   (on the endpoint path aparté may start the calls of one step together);
 *   reads never wait for them. A tool whose effect is not one the registry
 *   knows is taken as one that runs something.
 * - A failure is a result the model reads, never an exception; an output too
 *   long for the context is cut, and the cut said.
 */

import { createHash } from 'node:crypto';
import { KeyedQueue } from '../fs/json-file.js';
import { capToolOutput } from './output-cap.js';
import type { ToolCall, ToolContext, ToolDef, ToolHandler, ToolResult } from './types.js';

export type { ToolCall, ToolContext, ToolHandler, ToolOutput } from './types.js';

export interface RegisteredTool {
  def: ToolDef;
  handler: ToolHandler;
}

export interface ToolInventorySnapshot {
  /** The tools' names, sorted. */
  names: string[];
  /** What the model was told, fingerprinted: the same set gives the same hash, whatever the order. */
  hash: string;
}

export interface ToolInventoryDelta {
  added: ToolDef[];
  removed: string[];
}

/** What a turn sees of the registry: the tools of its conversation (a plugin a project turned off is not there). */
export interface ToolSet {
  list(): ToolDef[];
  get(name: string): RegisteredTool | undefined;
  run(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}

/** Reads and what only the window runs never wait for a write. */
const WAITS_FOR_NOTHING = new Set(['read', 'network', 'ui']);

function failed(call: ToolCall, content: string): ToolResult {
  return { toolCallId: call.id, name: call.name, content, failed: true };
}

export class ToolRegistry implements ToolSet {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly listeners = new Set<(delta: ToolInventoryDelta) => void>();
  /** The writes and runs of each conversation, one at a time. */
  private readonly queue = new KeyedQueue();

  register(def: ToolDef, handler: ToolHandler): void {
    if (this.tools.has(def.name)) throw new Error(`Tool already registered: ${def.name}`);
    this.tools.set(def.name, { def, handler });
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
    return [...this.tools.values()].map((tool) => tool.def).sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(): ToolInventorySnapshot {
    const defs = this.list();
    const material = defs.map((def) => [def.name, def.description, def.effect, def.source, def.where, def.inputSchema]);
    return {
      names: defs.map((def) => def.name),
      hash: createHash('sha256').update(JSON.stringify(material)).digest('hex'),
    };
  }

  diff(previous: ToolInventorySnapshot): ToolInventoryDelta {
    const before = new Set(previous.names);
    const now = this.list();
    return {
      added: now.filter((def) => !before.has(def.name)),
      removed: previous.names.filter((name) => !this.tools.has(name)),
    };
  }

  /** The tools `visible` lets through, read at each call: the view follows the registry. */
  view(visible: (def: ToolDef) => boolean): ToolSet {
    const shown = (name: string): RegisteredTool | undefined => {
      const tool = this.tools.get(name);
      return tool && visible(tool.def) ? tool : undefined;
    };
    return {
      list: () => this.list().filter(visible),
      get: shown,
      run: (call, ctx) =>
        shown(call.name) ? this.run(call, ctx) : Promise.resolve(failed(call, `There is no tool named ${call.name}.`)),
    };
  }

  onChange(listener: (delta: ToolInventoryDelta) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  run(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) return Promise.resolve(failed(call, `There is no tool named ${call.name}.`));
    const execute = (): Promise<ToolResult> => this.execute(tool, call, ctx);
    return WAITS_FOR_NOTHING.has(tool.def.effect) ? execute() : this.queue.run(ctx.conversationId, execute);
  }

  private async execute(tool: RegisteredTool, call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const output = await tool.handler(call, ctx);
      return {
        toolCallId: call.id,
        name: call.name,
        content: capToolOutput(output.content, ctx.nCtx),
        ...(output.structuredContent !== undefined ? { structuredContent: output.structuredContent } : {}),
        ...(output.failed ? { failed: true } : {}),
      };
    } catch (error) {
      return failed(call, `The tool ${call.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private emit(delta: ToolInventoryDelta): void {
    for (const listener of [...this.listeners]) listener(delta);
  }
}
