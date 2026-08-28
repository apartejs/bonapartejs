/**
 * Backend type registry — the extension point: plugins register their
 * providers here, on the same footing as llama.cpp included by default.
 */

import type { Backend } from './types.js';

export interface BackendType {
  id: string;
  /** Displayable label (schema-driven settings will hook into this). */
  label: string;
  /** Builds an instance from an opaque config (validated upstream). */
  create(config: Record<string, unknown>): Backend | Promise<Backend>;
}

export class BackendRegistry {
  private readonly types = new Map<string, BackendType>();

  register(type: BackendType): void {
    if (this.types.has(type.id)) {
      throw new Error(`Backend type already registered: ${type.id}`);
    }
    this.types.set(type.id, type);
  }

  unregister(id: string): void {
    this.types.delete(id);
  }

  get(id: string): BackendType {
    const type = this.types.get(id);
    if (!type) {
      throw new Error(
        `Unknown backend type: ${id} (available: ${[...this.types.keys()].join(', ') || 'none'})`,
      );
    }
    return type;
  }

  list(): BackendType[] {
    return [...this.types.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
