/**
 * Boucle agentique.
 *
 * Elle est maison plutôt que bâtie sur `runStreamAgent` (@aparte/engine) : cet
 * engine possède la liste de messages et la re-sérialise à chaque tour, ce qui
 * est incompatible avec notre invariant append-only (un prompt dont chaque
 * tour ÉTEND octet-pour-octet le précédent). Voir le journal de friction.
 *
 * Invariants tenus ici :
 * - un tour = begin/complete sur le PromptLog, jamais de re-rendu ;
 * - la grammaire est régénérée depuis l'inventaire courant à chaque requête ;
 * - un outil inconnu, refusé ou en erreur produit un RÉSULTAT réinjecté au
 *   modèle, jamais une exception qui casserait la conversation.
 */

import type { Backend } from '../backend/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';
import { parseHermesOutput } from '../wire/hermes-parser.js';
import type { PromptLog } from '../wire/qwen-template.js';
import { HermesStreamDemux } from '../wire/stream-demux.js';
import { renderToolResults, type ToolOutcome } from '../wire/system-prompt.js';

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Commande complète pour les outils d'exécution (aperçu UI). */
  command?: string;
}

export type ApprovalResolver = (request: ApprovalRequest) => Promise<boolean>;

export interface AgentLoopOptions {
  backend: Backend;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  projectRoot: string;
  /** Nombre max d'allers-retours modèle↔outils pour un message. @default 10 */
  maxTurns?: number;
  approve?: ApprovalResolver;
  idSlot?: number;
  thinking?: boolean;
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'turn_end'; promptMs: number; cachedTokens: number }
  | { type: 'error'; message: string }
  // ── mutations du log : l'appelant les persiste pour rejouer un prompt
  //    octet-identique. L'UI les ignore.
  | { type: 'assistant_committed'; raw: string; thinking: boolean }
  | { type: 'service_appended'; text: string };

const DEFAULT_MAX_TURNS = 10;

export class AgentLoop {
  private approvalSeq = 0;

  constructor(private readonly options: AgentLoopOptions) {}

  async *run(
    log: PromptLog,
    userText: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    log.appendUser(userText);

    for (let turn = 0; turn < maxTurns; turn++) {
      const prompt = log.beginAssistantTurn({
        thinking: this.options.thinking ?? false,
      });

      let raw = '';
      let promptMs = 0;
      let cachedTokens = 0;
      const demux = new HermesStreamDemux();

      try {
        // Grammaire régénérée ici : elle reflète l'inventaire de CE tour.
        const constraint = this.options.registry.grammar();
        for await (const event of this.options.backend.complete({
          prompt,
          idSlot: this.options.idSlot ?? 0,
          cachePrompt: true,
          returnProgress: true,
          signal,
          ...(constraint
            ? {
                grammar: constraint.grammar,
                grammarLazy: constraint.grammarLazy,
                grammarTriggers: constraint.grammarTriggers,
                preservedTokens: constraint.preservedTokens,
              }
            : {}),
        })) {
          if (event.type === 'token') {
            for (const out of demux.push(event.text)) {
              yield out.type === 'text'
                ? { type: 'token', text: out.delta }
                : { type: 'thinking', text: out.delta };
            }
          } else {
            promptMs = event.stats.promptMs;
            cachedTokens = event.stats.progress?.cache ?? 0;
          }
        }
        for (const out of demux.flush()) {
          yield out.type === 'text'
            ? { type: 'token', text: out.delta }
            : { type: 'thinking', text: out.delta };
        }
      } finally {
        raw = demux.raw;
        // Le tour est gelé même en cas d'interruption : le préfixe reste
        // cohérent avec ce que le serveur a réellement vu.
        log.completeAssistantTurn(raw);
      }

      yield {
        type: 'assistant_committed',
        raw,
        thinking: this.options.thinking ?? false,
      };

      const parsed = parseHermesOutput(raw);
      if (parsed.calls.length === 0) {
        yield { type: 'turn_end', promptMs, cachedTokens };
        return;
      }

      const outcomes: ToolOutcome[] = [];
      for (const call of parsed.calls) {
        yield { type: 'tool_call', name: call.name, args: call.arguments };
        const outcome = await this.dispatch(call.name, call.arguments, signal);
        outcomes.push(outcome);
        yield {
          type: 'tool_result',
          name: outcome.name,
          ok: outcome.ok,
          content: outcome.content,
        };
      }

      const serviceText = renderToolResults(outcomes);
      log.appendUser(serviceText);
      yield { type: 'service_appended', text: serviceText };

      if (signal.aborted) {
        yield { type: 'turn_end', promptMs, cachedTokens };
        return;
      }
    }

    yield {
      type: 'error',
      message: `Reached the limit of ${maxTurns} tool round-trips: loop stopped.`,
    };
  }

  private async dispatch(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const registered = this.options.registry.get(name);
    if (!registered) {
      const available = this.options.registry.list().map((d) => d.name);
      return {
        name,
        ok: false,
        content:
          `Unknown tool: ${name}. Available tools: ` +
          `${available.join(', ') || 'none'}.`,
      };
    }

    const command =
      typeof args['command'] === 'string' ? (args['command'] as string) : undefined;
    const decision = this.options.permissions.evaluate({
      tool: name,
      effect: registered.def.effect,
      ...(command !== undefined ? { command } : {}),
    });

    if (decision === 'deny') {
      return {
        name,
        ok: false,
        content:
          `Denied by the current play mode (${this.options.permissions.getMode()}): ` +
          `${name} (${registered.def.effect}). Propose a read-only alternative.`,
      };
    }

    if (decision === 'ask') {
      const approve = this.options.approve;
      if (!approve) {
        // Fail-safe : sans interlocuteur pour accorder, on n'agit pas.
        return {
          name,
          ok: false,
          content: `Not authorized: ${name} requires approval, which is unavailable here.`,
        };
      }
      const granted = await approve({
        id: `approval-${this.approvalSeq++}`,
        tool: name,
        args,
        ...(command !== undefined ? { command } : {}),
      });
      if (!granted) {
        return {
          name,
          ok: false,
          content: `The user declined this action: ${name}.`,
        };
      }
    }

    try {
      const result = await registered.handler(args, {
        projectRoot: this.options.projectRoot,
        signal,
      });
      return { name, ok: result.ok, content: result.content };
    } catch (error) {
      return {
        name,
        ok: false,
        content: `Tool ${name} threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
