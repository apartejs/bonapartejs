/**
 * Prompt système et messages de service.
 *
 * Le prompt système est FIGÉ à la création de la conversation : il porte
 * l'inventaire d'outils de ce moment-là. Tout changement ultérieur passe par
 * un message de delta APPENDÉ — jamais par un re-rendu, sinon le préfixe du
 * cache KV saute et le différenciateur produit avec.
 */

import type { ToolDef, ToolInventoryDelta } from '../tools/types.js';

export interface SystemPromptOptions {
  projectRoot: string;
  tools: ToolDef[];
  /** Consignes de projet (CLAUDE.md & co) — optionnel. */
  projectInstructions?: string;
}

function renderToolLine(tool: ToolDef): string {
  return `- ${tool.name} : ${tool.description}\n  arguments : ${JSON.stringify(tool.inputSchema)}`;
}

export function renderToolInventory(tools: ToolDef[]): string {
  if (tools.length === 0) return 'Aucun outil disponible.';
  return tools.map(renderToolLine).join('\n');
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const blocks = [
    'Tu es bonaparte, un agent de développement local-first. Tu travailles sur ' +
      'un projet réel : sois précis, concis, et vérifie plutôt que supposer.',
    `Projet ouvert : ${options.projectRoot}\n` +
      'Tous les chemins d’outils sont relatifs à cette racine ; tu ne peux pas ' +
      'en sortir.',
    'Outils disponibles :\n' + renderToolInventory(options.tools),
    'Pour appeler un outil, émets exactement :\n' +
      '<tool_call>{"name": "nom_outil", "arguments": {…}}</tool_call>\n' +
      'Un appel par bloc ; plusieurs blocs pour plusieurs appels. Le résultat ' +
      'te sera renvoyé au tour suivant.',
    // Sans cette clause, un delta appendé plus tard contredirait ce prompt.
    'Cet inventaire peut être amendé ultérieurement : un message de service ' +
      'annoncera tout outil ajouté ou retiré, et fera alors autorité sur la ' +
      'liste ci-dessus.',
  ];

  if (options.projectInstructions) {
    blocks.push(`Consignes du projet :\n${options.projectInstructions}`);
  }

  return blocks.join('\n\n');
}

/** Message appendé quand l'outillage change en cours de conversation. */
export function renderInventoryDelta(delta: ToolInventoryDelta): string | null {
  if (delta.added.length === 0 && delta.removed.length === 0) return null;

  const parts = ['[mise à jour de l’inventaire d’outils]'];
  if (delta.added.length > 0) {
    parts.push(
      `Outils désormais disponibles :\n${delta.added.map(renderToolLine).join('\n')}`,
    );
  }
  if (delta.removed.length > 0) {
    parts.push(
      `Outils retirés (ne plus les appeler) : ${delta.removed.join(', ')}`,
    );
  }
  return parts.join('\n');
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  content: string;
}

/** Tour « utilisateur » qui rend les résultats d'outils au modèle. */
export function renderToolResults(outcomes: ToolOutcome[]): string {
  return outcomes
    .map(
      (outcome) =>
        `[résultat de ${outcome.name} — ${outcome.ok ? 'succès' : 'échec'}]\n${outcome.content}`,
    )
    .join('\n\n');
}
