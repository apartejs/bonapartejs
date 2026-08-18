/**
 * Rendu d'un transcript en prompt Qwen APPEND-ONLY.
 *
 * C'est ici, et nulle part ailleurs, que vit la contrainte de stabilité
 * octet : le rendu du tour N+1 étend celui du tour N. Le transcript est la
 * source de vérité ; ce module ne fait qu'y ajouter ce qu'il n'a pas encore
 * rendu, et sait aussi tout rejouer depuis zéro (réouverture de conversation)
 * de façon déterministe.
 */

import type { ToolDefLike, TranscriptEntry } from '../types.js';
import { PromptLog } from '../../wire/qwen-template.js';
import {
  buildSystemPrompt,
  renderToolResults,
} from '../../wire/system-prompt.js';
import type { SystemSpec } from '../types.js';

export interface RenderedTurn {
  /** Prompt complet à envoyer à /completion. */
  prompt: string;
  /** Sortie brute du tour, à geler une fois la génération finie. */
  commit(raw: string): void;
}

export class TranscriptRenderer {
  private log: PromptLog | null = null;
  private rendered = 0;
  private frozenSystemPrompt: string | null = null;
  private turnOpen = false;

  /** Prompt système figé : re-le construire le ferait dériver. */
  get systemPrompt(): string | null {
    return this.frozenSystemPrompt;
  }

  restore(systemPrompt: string): void {
    this.frozenSystemPrompt = systemPrompt;
  }

  /**
   * Prépare le prompt du prochain tour à partir du transcript complet.
   * Les entrées déjà rendues ne le sont jamais deux fois.
   */
  /**
   * Fige le prompt système s'il ne l'est pas déjà. Appelé à l'ouverture de la
   * conversation : attendre le premier tour laisserait une fenêtre où un outil
   * ajouté entre-temps changerait le prompt sans qu'aucun delta ne l'annonce.
   */
  ensureSystemPrompt(system: SystemSpec, tools: ToolDefLike[]): string {
    if (this.frozenSystemPrompt === null) {
      this.frozenSystemPrompt = buildSystemPrompt({
        ...(system.projectRoot ? { projectRoot: system.projectRoot } : {}),
        tools: tools.map((t) => ({ ...t, effect: 'read' as const })),
        ...(system.replyLanguage ? { replyLanguage: system.replyLanguage } : {}),
        ...(system.projectInstructions
          ? { projectInstructions: system.projectInstructions }
          : {}),
      });
    }
    return this.frozenSystemPrompt;
  }

  next(
    transcript: TranscriptEntry[],
    system: SystemSpec,
    tools: ToolDefLike[],
    options: { thinking?: boolean } = {},
  ): RenderedTurn {
    const systemPrompt = this.ensureSystemPrompt(system, tools);
    if (this.log === null) {
      this.log = new PromptLog(systemPrompt);
      this.rendered = 0;
    }
    if (this.turnOpen) {
      // Tour précédent jamais gelé (erreur réseau) : on le referme à vide
      // pour ne pas laisser le log dans un état intermédiaire.
      this.log.completeAssistantTurn('');
      this.turnOpen = false;
    }

    for (const entry of transcript.slice(this.rendered)) {
      this.append(entry);
      this.rendered += 1;
    }

    const prompt = this.log.beginAssistantTurn({
      thinking: options.thinking ?? false,
    });
    this.turnOpen = true;

    return {
      prompt,
      commit: (raw: string) => {
        this.log?.completeAssistantTurn(raw);
        this.turnOpen = false;
        // Le tour assistant qui suivra dans le transcript est déjà rendu.
        this.rendered += 1;
      },
    };
  }

  private append(entry: TranscriptEntry): void {
    const log = this.log;
    if (!log) return;
    switch (entry.role) {
      case 'user':
      case 'service':
        log.appendUser(entry.text);
        break;
      case 'tool_results':
        log.appendUser(renderToolResults(entry.results));
        break;
      case 'assistant':
        // Rejeu (réouverture) : le tour est reconstitué tel qu'émis.
        log.beginAssistantTurn({ thinking: Boolean(entry.thinking) });
        log.completeAssistantTurn(rawOf(entry));
        break;
    }
  }

  /** Historique gelé — utilisé par les tests d'octet-identité. */
  get frozen(): string {
    return this.log?.frozen ?? '';
  }
}

/**
 * Sortie brute d'un tour assistant. Le verbatim du fournisseur fait foi — la
 * reconstitution depuis text/calls n'est qu'un filet pour les transcripts
 * venus d'un autre backend (le préfixe repart alors de ce point).
 */
function rawOf(entry: Extract<TranscriptEntry, { role: 'assistant' }>): string {
  if (entry.raw !== undefined) return entry.raw;
  const think = entry.thinking ? `<think>${entry.thinking}</think>` : '';
  const calls = (entry.calls ?? [])
    .map(
      (call) =>
        `<tool_call>{"name": "${call.name}", "arguments": ${JSON.stringify(call.arguments)}}</tool_call>`,
    )
    .join('');
  return `${think}${entry.text}${calls}`;
}
