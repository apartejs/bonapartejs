/**
 * Registre des types de backend — le point d'extension : les plugins
 * enregistrent ici leurs providers, au même titre que llama.cpp inclus
 * d'office.
 */

import type { Backend } from './types.js';

export interface BackendType {
  id: string;
  /** Libellé affichable (les settings schema-driven viendront s'y greffer). */
  label: string;
  /** Fabrique une instance à partir d'une config opaque (validée en amont). */
  create(config: Record<string, unknown>): Backend | Promise<Backend>;
}

export class BackendRegistry {
  private readonly types = new Map<string, BackendType>();

  register(type: BackendType): void {
    if (this.types.has(type.id)) {
      throw new Error(`Type de backend déjà enregistré : ${type.id}`);
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
        `Type de backend inconnu : ${id} (disponibles : ${[...this.types.keys()].join(', ') || 'aucun'})`,
      );
    }
    return type;
  }

  list(): BackendType[] {
    return [...this.types.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
