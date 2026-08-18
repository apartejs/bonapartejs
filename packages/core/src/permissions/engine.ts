/**
 * Moteur de permissions — les 4 modes de jeu.
 *
 * Lecture     : l'agent lit et répond, aucune écriture ni commande.
 * Répétition  : tout ce qui touche au système demande l'accord (défaut).
 * Plume       : l'agent tient la plume — éditions automatiques, commandes non.
 * Impro       : tout passe.
 *
 * Le mode est un PLAFOND : une règle mémorisée peut transformer un « demander »
 * en « autoriser », jamais lever un refus du mode.
 */

import type { ToolEffect } from '../tools/types.js';

export type PlayMode = 'lecture' | 'repetition' | 'plume' | 'impro';

export const PLAY_MODES: readonly PlayMode[] = [
  'lecture',
  'repetition',
  'plume',
  'impro',
];

export type PermissionDecision = 'allow' | 'ask' | 'deny';

/** Règle mémorisée pour un projet (« toujours autoriser ceci »). */
export interface AllowRule {
  tool: string;
  /** Pour les outils d'exécution : préfixe de commande autorisé. */
  commandPrefix?: string;
}

export interface PermissionQuery {
  tool: string;
  effect: ToolEffect;
  /** Commande complète, pour les outils d'exécution. */
  command?: string;
}

export class PermissionEngine {
  constructor(
    private mode: PlayMode = 'repetition',
    private rules: AllowRule[] = [],
  ) {}

  getMode(): PlayMode {
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    this.mode = mode;
  }

  listRules(): AllowRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  remember(rule: AllowRule): void {
    if (!this.rules.some((existing) => sameRule(existing, rule))) {
      this.rules = [...this.rules, { ...rule }];
    }
  }

  forget(rule: AllowRule): void {
    this.rules = this.rules.filter((existing) => !sameRule(existing, rule));
  }

  evaluate(query: PermissionQuery): PermissionDecision {
    const ceiling = MODE_MATRIX[this.mode][query.effect];
    // Le mode est un plafond : une règle ne peut qu'assouplir un « ask ».
    if (ceiling !== 'ask') return ceiling;
    return this.rules.some((rule) => matches(rule, query)) ? 'allow' : 'ask';
  }
}

const MODE_MATRIX: Record<PlayMode, Record<ToolEffect, PermissionDecision>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask' },
  plume: { read: 'allow', write: 'allow', execute: 'ask' },
  impro: { read: 'allow', write: 'allow', execute: 'allow' },
};

function sameRule(a: AllowRule, b: AllowRule): boolean {
  return a.tool === b.tool && a.commandPrefix === b.commandPrefix;
}

function matches(rule: AllowRule, query: PermissionQuery): boolean {
  if (rule.tool !== query.tool) return false;
  if (rule.commandPrefix === undefined) return true;
  const command = query.command ?? '';
  if (!command.startsWith(rule.commandPrefix)) return false;
  // Frontière de mot : « pnpm test » ne doit pas autoriser « pnpm testament ».
  const next = command.charAt(rule.commandPrefix.length);
  return next === '' || /\s/.test(next);
}
