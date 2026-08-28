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
  /**
   * Racines du projet, ORDONNÉES. Vide = aucun projet : les outils marchent
   * quand même, sans confinement.
   */
  roots?: string[];
  tools: ToolDef[];
  /** Langue attendue des réponses, en clair (ex. « French »). */
  replyLanguage?: string;
  /** Consignes de projet (CLAUDE.md & co) — optionnel. */
  projectInstructions?: string;
}

function renderToolLine(tool: ToolDef): string {
  return `- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`;
}

export function renderToolInventory(tools: ToolDef[]): string {
  if (tools.length === 0) return 'No tools available.';
  return tools.map(renderToolLine).join('\n');
}

/**
 * Bloc de décor : ce que le modèle peut voir.
 *
 * Avec plusieurs racines, il faut les NOMMER toutes et dire laquelle sert de
 * défaut aux chemins relatifs. Sans cette information, le modèle ne peut
 * atteindre les autres racines que par tâtonnement — l'ambiguïté se résout par
 * de l'information dans le prompt, pas par de la magie dans le résolveur.
 */
function renderPerimeter(roots: string[]): string {
  // Le projet est le PÉRIMÈTRE des outils, pas leur condition d'existence :
  // sans dossier ils marchent toujours. Le modèle ne doit ni réclamer un
  // dossier, ni croire qu'il ne peut rien lire.
  if (roots.length === 0) {
    return (
      'No project folder is open. Your tools still work: use absolute paths, ' +
      'or relative ones, which resolve from the user home directory. ' +
      'Nothing confines them to a folder, so name the exact path you are ' +
      'about to touch when it matters.'
    );
  }

  if (roots.length === 1) {
    return (
      `Open project: ${roots[0]}\n` +
      'All tool paths are relative to this root, and you cannot step outside it.'
    );
  }

  return (
    'Open project, spanning several source folders:\n' +
    roots
      .map((root, index) =>
        index === 0
          ? `- ${root}  (default: relative paths resolve here)`
          : `- ${root}`,
      )
      .join('\n') +
    '\nRelative paths resolve against the first folder. To reach another one, ' +
    'use its absolute path. You cannot step outside these folders.'
  );
}

/**
 * The system prompt, laid out from the most stable block to the most volatile.
 *
 * The KV prefix is saved and, eventually, shared by layers, so the order is
 * not cosmetic — it is baked into every state written to disk:
 *
 *   L0  identity and the tool-call convention   (changes with a bonaparte release)
 *   L1  the tool inventory and its amendment clause (changes when a plugin or an MCP server moves)
 *   L2  the decor of THIS conversation: perimeter, reply language, project instructions
 *
 * Put a volatile block before a stable one and the stable prefix can no
 * longer be shared between conversations. Changing this order later would
 * invalidate every state saved with the previous one.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const blocks = [
    // L0
    'You are bonaparte, a local-first coding agent working on a real project. ' +
      'Be precise and concise. Verify with tools instead of assuming.',
    'To call a tool, emit exactly:\n' +
      '<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>\n' +
      'One call per block; emit several blocks for several calls. ' +
      'Results are returned to you on the next turn.',
    // L1
    'Available tools:\n' + renderToolInventory(options.tools),
    // Without this clause, a delta appended later would contradict the prompt.
    'This inventory may be amended later: a service message will announce any ' +
      'tool added or removed, and takes precedence over the list above.',
    // L2
    renderPerimeter(options.roots ?? []),
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
export function renderPerimeterDelta(
  previous: string[],
  current: string[],
): string | null {
  // L'ORDRE compte autant que le contenu : la première racine est le défaut
  // des chemins relatifs, donc réordonner change le comportement des outils et
  // doit être annoncé comme le reste.
  if (previous.length === current.length && previous.every((r, i) => r === current[i])) {
    return null;
  }

  if (current.length === 0) {
    return (
      '[project update]\n' +
      'The project folders were closed. Your tools still work, but nothing ' +
      'confines them any more: relative paths resolve from the user home ' +
      'directory. Name the exact path you are about to touch.'
    );
  }

  const added = current.filter((root) => !previous.includes(root));
  const removed = previous.filter((root) => !current.includes(root));
  const parts = ['[project update]', 'The project now spans these folders:'];
  parts.push(
    current
      .map((root, index) =>
        index === 0 ? `- ${root}  (default for relative paths)` : `- ${root}`,
      )
      .join('\n'),
  );
  if (added.length > 0) parts.push(`Added: ${added.join(', ')}`);
  if (removed.length > 0) {
    parts.push(`Removed (do not touch them any more): ${removed.join(', ')}`);
  }
  parts.push(
    'This list supersedes anything said earlier about the project folders.',
  );
  return parts.join('\n');
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
