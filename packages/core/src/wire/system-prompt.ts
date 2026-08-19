/**
 * Prompt système et messages de service.
 *
 * TOUT ce qui part vers le modèle est en ANGLAIS : c'est un protocole, pas de
 * l'UI. Les modèles (Qwen inclus) sont entraînés majoritairement en anglais
 * pour l'instruction et le tool-calling ; mélanger les langues sur le fil
 * dégrade la fiabilité des appels. La langue de RÉPONSE, elle, est une
 * consigne explicite (`replyLanguage`). L'i18n fr/en concerne l'interface,
 * jamais le fil.
 *
 * Le prompt système est FIGÉ à la création de la conversation : il porte
 * l'inventaire d'outils de ce moment-là. Tout changement ultérieur passe par
 * un message de delta APPENDÉ — jamais par un re-rendu, sinon le préfixe du
 * cache KV saute et le différenciateur produit avec.
 */

import type { ToolOutcome } from '../backend/types.js';
import type { ToolDef, ToolInventoryDelta } from '../tools/types.js';

export interface SystemPromptOptions {
  /** Absent = aucun projet ouvert (les outils disque sont indisponibles). */
  projectRoot?: string;
  tools: ToolDef[];
  /** Langue attendue des réponses, en clair (ex. « French »). */
  replyLanguage?: string;
  /** Consignes de projet (CLAUDE.md & co) — optionnel. */
  projectInstructions?: string;
  /**
   * Décrire la convention d'appel Hermes (défaut). À couper pour un serveur
   * qui gère les outils nativement : lui montrer la syntaxe textuelle
   * l'inciterait à écrire des balises plutôt qu'à appeler.
   */
  toolCallFormat?: boolean;
}

function renderToolLine(tool: ToolDef): string {
  return `- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`;
}

export function renderToolInventory(tools: ToolDef[]): string {
  if (tools.length === 0) return 'No tools available.';
  return tools.map(renderToolLine).join('\n');
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const blocks = [
    'You are bonaparte, a local-first coding agent working on a real project. ' +
      'Be precise and concise. Verify with tools instead of assuming.',
    options.projectRoot
      ? `Open project: ${options.projectRoot}\n` +
        'All tool paths are relative to this root, and you cannot step outside it.'
      : // Le projet est le PÉRIMÈTRE des outils, pas leur condition
        // d'existence : sans dossier ils marchent toujours, simplement sans
        // confinement. Le modèle ne doit ni réclamer un dossier, ni croire
        // qu'il ne peut rien lire.
        'No project folder is open. Your tools still work: use absolute paths, ' +
        'or relative ones, which resolve from the user home directory. ' +
        'Nothing confines them to a folder, so name the exact path you are ' +
        'about to touch when it matters.',
    'Available tools:\n' + renderToolInventory(options.tools),
    ...(options.toolCallFormat === false
      ? []
      : [
          'To call a tool, emit exactly:\n' +
            '<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>\n' +
            'One call per block; emit several blocks for several calls. ' +
            'Results are returned to you on the next turn.',
        ]),
    // Sans cette clause, un delta appendé plus tard contredirait ce prompt.
    'This inventory may be amended later: a service message will announce any ' +
      'tool added or removed, and takes precedence over the list above.',
  ];

  if (options.replyLanguage) {
    blocks.push(`Write your replies to the user in ${options.replyLanguage}.`);
  }
  if (options.projectInstructions) {
    blocks.push(`Project instructions:\n${options.projectInstructions}`);
  }

  return blocks.join('\n\n');
}

/**
 * Message appendé quand le PROJET change en cours de conversation.
 *
 * Le prompt système est figé à la création : s'il a été figé sans projet et
 * qu'un dossier est ouvert ensuite, le modèle continuerait de répondre qu'il
 * ne peut pas lire de fichiers — alors que les outils sont bel et bien là.
 * Le delta d'inventaire annonce les outils ; il fallait aussi annoncer le
 * décor dans lequel ils travaillent.
 */
export function renderProjectDelta(
  previous: string | undefined,
  current: string | undefined,
): string | null {
  if (previous === current) return null;

  if (current) {
    return (
      '[project update]\n' +
      `A project folder is now open: ${current}\n` +
      'All tool paths resolve inside this root, and you cannot step outside ' +
      'it. This supersedes anything said earlier about no project being open.'
    );
  }
  return (
    '[project update]\n' +
    'The project folder was closed, so file and shell tools are no longer ' +
    'available. You can still discuss and reason.'
  );
}

/** Message appendé quand l'outillage change en cours de conversation. */
export function renderInventoryDelta(delta: ToolInventoryDelta): string | null {
  if (delta.added.length === 0 && delta.removed.length === 0) return null;

  const parts = ['[tool inventory update]'];
  if (delta.added.length > 0) {
    parts.push(`Tools now available:\n${delta.added.map(renderToolLine).join('\n')}`);
  }
  if (delta.removed.length > 0) {
    parts.push(`Tools removed (do not call them): ${delta.removed.join(', ')}`);
  }
  return parts.join('\n');
}

/** Défini une fois pour toutes dans le contrat de backend. */
export type { ToolOutcome } from '../backend/types.js';

/** Tour « utilisateur » qui rend les résultats d'outils au modèle. */
export function renderToolResults(outcomes: ToolOutcome[]): string {
  return outcomes
    .map(
      (outcome) =>
        `[tool result: ${outcome.name} — ${outcome.ok ? 'ok' : 'failed'}]\n${outcome.content}`,
    )
    .join('\n\n');
}
