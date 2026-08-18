/**
 * Templating Qwen3 côté client — LE module qui rend le kv-store utile.
 *
 * Le template Jinja officiel n'est pas byte-stable d'un tour à l'autre
 * (issue QwenLM/Qwen3#1826) : re-templater l'historique casse le cache de
 * préfixe. Ici, le prompt du tour N+1 ÉTEND par construction celui du tour
 * N : l'historique gelé n'est jamais re-rendu, les blocs <think> émis restent
 * verbatim, et le choix thinking/no-thinking ne joue que sur le suffixe de
 * génération du tour courant.
 *
 * Aucun BOS applicatif : /completion l'insère lui-même selon le modèle
 * (piège du double-BOS déjà rencontré sur monaparte).
 */

export const IM_START = '<|im_start|>';
export const IM_END = '<|im_end|>';

export interface AssistantTurnOptions {
  /** true : le modèle peut émettre <think>… ; false : bloc think vide forcé. */
  thinking: boolean;
}

export function renderSystem(text: string): string {
  return `${IM_START}system\n${text}${IM_END}\n`;
}

export function renderUser(text: string): string {
  return `${IM_START}user\n${text}${IM_END}\n`;
}

const ASSISTANT_HEADER = `${IM_START}assistant\n`;
const EMPTY_THINK = '<think>\n\n</think>\n\n';

/**
 * Accumulateur append-only du prompt d'une conversation.
 * Cycle : appendUser() → beginAssistantTurn() → (le serveur génère `raw`)
 * → completeAssistantTurn(raw) → appendUser() → …
 *
 * Garantie par construction : le prompt retourné par beginAssistantTurn au
 * tour N+1 étend octet-pour-octet celui du tour N suivi de la génération —
 * l'historique n'est JAMAIS re-rendu.
 */
export class PromptLog {
  private history: string;
  /** Prompt envoyé au serveur pour le tour assistant en cours, sinon null. */
  private pendingPrompt: string | null = null;

  constructor(systemPrompt: string) {
    this.history = renderSystem(systemPrompt);
  }

  /** Historique gelé (préfixe stable pour le cache). */
  get frozen(): string {
    return this.history;
  }

  appendUser(text: string): void {
    if (this.pendingPrompt !== null) {
      throw new Error(
        'appendUser impossible : un tour assistant est en cours (completeAssistantTurn attendu).',
      );
    }
    this.history += renderUser(text);
  }

  /** Retourne le prompt COMPLET à envoyer à /completion pour ce tour. */
  beginAssistantTurn(options: AssistantTurnOptions): string {
    if (this.pendingPrompt !== null) {
      throw new Error(
        'beginAssistantTurn impossible : un tour assistant est déjà en cours.',
      );
    }
    const suffix = options.thinking
      ? ASSISTANT_HEADER
      : ASSISTANT_HEADER + EMPTY_THINK;
    this.pendingPrompt = this.history + suffix;
    return this.pendingPrompt;
  }

  /** Gèle le tour : `raw` est la sortie brute du modèle, verbatim. */
  completeAssistantTurn(raw: string): void {
    if (this.pendingPrompt === null) {
      throw new Error(
        'completeAssistantTurn impossible : aucun tour assistant en cours.',
      );
    }
    // L'historique devient exactement ce que le serveur a vu + généré :
    // prompt du tour (suffixe compris) + sortie verbatim + terminateur.
    this.history = this.pendingPrompt + raw + `${IM_END}\n`;
    this.pendingPrompt = null;
  }
}
