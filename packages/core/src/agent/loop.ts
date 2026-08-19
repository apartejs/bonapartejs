/**
 * Boucle agentique — AGNOSTIQUE du fournisseur.
 *
 * Elle ne manipule qu'un transcript sémantique et des événements structurés :
 * elle ignore tout du prompt brut, de la grammaire GBNF et du format Hermes.
 * Comment une conversation devient une requête est l'affaire du backend —
 * aujourd'hui un seul, le prompt append-only de llama.cpp. Cette frontière
 * reste la même : c'est elle qui garde la boucle testable sans serveur.
 *
 * Elle n'est pas bâtie sur `runStreamAgent` (@aparte/engine) : cet engine
 * possède la liste de messages et la re-sérialise à chaque tour, incompatible
 * avec un backend à préfixe stable. Voir le journal de friction.
 */

import type {
  Backend,
  SamplingParams,
  SystemSpec,
  ToolCall,
  ToolOutcome,
  TranscriptEntry,
} from '../backend/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';

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
  system: SystemSpec;
  conversationId: string;
  /** Nombre max d'allers-retours modèle↔outils pour un message. @default 10 */
  maxTurns?: number;
  approve?: ApprovalResolver;
  idSlot?: number;
  /** Échantillonnage de la conversation (température & co). */
  sampling?: SamplingParams;
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'turn_end'; promptMs: number; cachedTokens: number }
  | { type: 'error'; message: string }
  // ── mutations du transcript : l'appelant les persiste pour rejouer à
  //    l'identique. L'UI les ignore.
  | { type: 'assistant_committed'; entry: TranscriptEntry }
  | { type: 'results_committed'; entry: TranscriptEntry };

const DEFAULT_MAX_TURNS = 10;

export class AgentLoop {
  private approvalSeq = 0;

  constructor(private readonly options: AgentLoopOptions) {}

  /**
   * Déroule un message. `transcript` est muté en append-only : c'est la
   * source de vérité partagée avec la persistance.
   */
  async *run(
    transcript: TranscriptEntry[],
    userText: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    transcript.push({ role: 'user', text: userText });

    for (let turn = 0; turn < maxTurns; turn++) {
      let text = '';
      let thinking = '';
      const calls: ToolCall[] = [];
      let promptMs = 0;
      let cachedTokens = 0;
      let raw: string | undefined;

      for await (const event of this.options.backend.runTurn({
        conversationId: this.options.conversationId,
        system: this.options.system,
        tools: this.options.registry.list(),
        transcript,
        signal,
        ...(this.options.idSlot !== undefined ? { idSlot: this.options.idSlot } : {}),
        ...(this.options.sampling ? { sampling: this.options.sampling } : {}),
      })) {
        switch (event.type) {
          case 'text':
            text += event.delta;
            yield { type: 'token', text: event.delta };
            break;
          case 'thinking':
            thinking += event.delta;
            yield { type: 'thinking', text: event.delta };
            break;
          case 'tool_use':
            calls.push(event.call);
            break;
          case 'done':
            promptMs = event.stats.promptMs;
            cachedTokens = event.stats.progress?.cache ?? 0;
            raw = event.raw;
            break;
        }
      }

      const entry: TranscriptEntry = {
        role: 'assistant',
        text,
        ...(thinking ? { thinking } : {}),
        ...(calls.length > 0 ? { calls } : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
      transcript.push(entry);
      yield { type: 'assistant_committed', entry };

      if (calls.length === 0) {
        yield { type: 'turn_end', promptMs, cachedTokens };
        return;
      }

      const results: ToolOutcome[] = [];
      for (const call of calls) {
        yield { type: 'tool_call', name: call.name, args: call.arguments };
        const outcome = await this.dispatch(call, signal);
        results.push(outcome);
        yield {
          type: 'tool_result',
          name: outcome.name,
          ok: outcome.ok,
          content: outcome.content,
        };
      }

      const resultsEntry: TranscriptEntry = { role: 'tool_results', results };
      transcript.push(resultsEntry);
      yield { type: 'results_committed', entry: resultsEntry };

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
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const { name, arguments: args } = call;
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

    const projectRoot = this.options.system.projectRoot;
    if (!projectRoot) {
      // Sans projet, les outils disque ne sont pas dans l'inventaire ; ce
      // garde-fou couvre un outil enregistré par ailleurs.
      return {
        name,
        ok: false,
        content: `No project is open, so ${name} cannot run. Ask the user to open a project folder.`,
      };
    }

    try {
      const result = await registered.handler(args, { projectRoot, signal });
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
