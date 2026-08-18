/**
 * Registre unique des outils : cœur + plugins + MCP. C'est lui qui produit la
 * grammaire (donc ce que le modèle peut littéralement émettre) et les deltas
 * d'inventaire appendés au log quand l'outillage change en cours de
 * conversation — jamais de re-rendu de l'historique.
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
      throw new Error(`Outil déjà enregistré : ${def.name}`);
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
    // L'empreinte couvre nom + description + schéma : deux inventaires
    // identiques enregistrés dans un ordre différent donnent le même hash.
    const material = JSON.stringify(
      defs.map((d) => [d.name, d.description, d.effect, d.inputSchema]),
    );
    return {
      names: defs.map((d) => d.name),
      hash: createHash('sha256').update(material).digest('hex'),
    };
  }

  /** Ce qui a changé depuis une photo (added porte les définitions). */
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
