/**
 * System prompt and service messages.
 *
 * EVERYTHING that goes to the model is in ENGLISH: it's a protocol, not
 * UI. Models (Qwen included) are trained predominantly in English for
 * instruction-following and tool-calling; mixing languages on the wire
 * degrades call reliability. The REPLY language, on the other hand, is an
 * explicit instruction (`replyLanguage`). fr/en i18n concerns the
 * interface, never the wire.
 *
 * The system prompt is FROZEN when the conversation is created: it
 * carries the tool inventory from that moment. Any later change goes
 * through an APPENDED delta message — never a re-render, otherwise the KV
 * cache prefix drops and the differentiator along with it.
 */

import { neutralizeControlTokens } from './control-tokens.js';
import type { ToolOutcome } from '../backend/types.js';
import type { ToolDef, ToolInventoryDelta } from '../tools/types.js';

export interface SystemPromptOptions {
  /**
   * Project roots, ORDERED. Empty = no project: the tools still work,
   * with no confinement.
   */
  roots?: string[];
  tools: ToolDef[];
  /** Expected reply language, in plain words (e.g. "French"). */
  replyLanguage?: string;
  /** Project instructions (CLAUDE.md & co) — optional. */
  projectInstructions?: string;
}

/**
 * A tool's line. Its description and schema may come from elsewhere — an
 * MCP server writes its own — so they cannot open a role (audit C3).
 */
function renderToolLine(tool: ToolDef): string {
  return neutralizeControlTokens(`- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`);
}

export function renderToolInventory(tools: ToolDef[]): string {
  if (tools.length === 0) return 'No tools available.';
  return tools.map(renderToolLine).join('\n');
}

/**
 * Scenery block: what the model can see.
 *
 * With multiple roots, all of them must be NAMED, along with which one
 * serves as the default for relative paths. Without this information,
 * the model can only reach the other roots by trial and error — the
 * ambiguity is resolved with information in the prompt, not magic in the
 * resolver.
 */
function renderPerimeter(roots: string[]): string {
  // The project is the tools' PERIMETER, not their condition of
  // existence: without a folder they still work. The model must neither
  // demand a folder, nor believe it can't read anything.
  if (roots.length === 0) {
    return (
      'No project folder is open. Your tools still work inside the user home ' +
      'directory: relative paths resolve from it, and a path outside it is ' +
      'refused. Name the exact path you are about to touch when it matters.'
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
    // Anyone who can commit to the project writes this file.
    blocks.push(`Project instructions:\n${neutralizeControlTokens(options.projectInstructions)}`);
  }

  return blocks.join('\n\n');
}

/**
 * Message appended when the PROJECT changes mid-conversation.
 *
 * The system prompt is frozen at creation: if it was frozen with no
 * project and a folder is opened afterward, the model would keep
 * replying that it can't read files — even though the tools are right
 * there. The inventory delta announces the tools; the scenery they work
 * in also needed to be announced.
 */
export function renderPerimeterDelta(
  previous: string[],
  current: string[],
): string | null {
  // The ORDER matters as much as the content: the first root is the
  // default for relative paths, so reordering changes the tools'
  // behavior and must be announced like everything else.
  if (previous.length === current.length && previous.every((r, i) => r === current[i])) {
    return null;
  }

  if (current.length === 0) {
    return (
      '[project update]\n' +
      'The project folders were closed. Your tools still work, confined to ' +
      'the user home directory: relative paths resolve from it. Name the ' +
      'exact path you are about to touch.'
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

/**
 * The project instructions changed since the system prompt was frozen: the
 * new text is appended, never re-rendered into the frozen prompt.
 */
export function renderInstructionsDelta(current: string | undefined): string {
  if (!current) {
    return '[project update]\nThe project instructions no longer exist: disregard the ones in the system prompt.';
  }
  return `[project update]\nThe project instructions changed. They now read:\n${neutralizeControlTokens(current)}`;
}

/** Message appended when the tooling changes mid-conversation. */
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

/** Defined once and for all in the backend contract. */
export type { ToolOutcome } from '../backend/types.js';

/** "user" turn that renders tool results to the model. */
export function renderToolResults(outcomes: ToolOutcome[]): string {
  return outcomes
    .map(
      (outcome) =>
        `[tool result: ${outcome.name} — ${outcome.ok ? 'ok' : 'failed'}]\n${outcome.content}`,
    )
    .join('\n\n');
}
