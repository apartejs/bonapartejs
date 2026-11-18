/**
 * The system prompt of a conversation, in two system turns. Everything in it
 * is English: it is a protocol, and models are trained on English
 * instructions and tool calls. The reply language is an instruction of its
 * own.
 *
 *   1. `stable` — identity, how to call a tool, the amendment clause, then
 *      the tools, where the family's template puts them (Gemma: its
 *      declarations close the turn). The same for every conversation of a
 *      kind on a model: a seed of this turn serves them all (spec §7.2).
 *   2. `project` — this conversation's decor: the project's folders (the
 *      first is the default), the reply language, the project's instructions.
 *
 * Both are frozen when the conversation is created; a later change is a
 * delta appended to the journal (`deltas.ts`), never a re-render. The order
 * is baked into every KV state saved: changing it invalidates them all.
 */

import { neutralizeControlTokens } from '../families/control-tokens.js';
import type { FamilyLayer } from '../families/types.js';
import type { ToolDef } from '../tools/types.js';

export type ConversationKind = 'code' | 'discussion';

export interface SystemPromptOptions {
  kind: ConversationKind;
  family: FamilyLayer;
  tools: readonly ToolDef[];
  /** The project's folders, the first the default for relative paths; empty: no project. */
  perimeter: readonly string[];
  /** In plain words: « French ». */
  replyLanguage?: string;
  /** AGENTS.md and the like: anyone who can commit wrote them. */
  projectInstructions?: string;
}

export interface SystemPrompt {
  stable: string;
  project: string;
}

const IDENTITY: Record<ConversationKind, string> = {
  code:
    'You are bonaparte, a local-first coding agent working on a real project on the person’s computer. ' +
    'Be precise and concise. Verify with tools instead of assuming.',
  discussion:
    'You are bonaparte, a local-first assistant. In this conversation you read files and the web to answer, ' +
    'and you change nothing on the computer. Be precise and concise.',
};

// Without it, a delta appended later would contradict the frozen prompt.
const AMENDMENT =
  'The list of tools may be amended later in this conversation: an update will announce any tool added or ' +
  'removed, and it takes precedence over the list given here.';

/** A discussion reads and fetches; it never writes nor runs anything (spec §2). */
export function toolsFor(kind: ConversationKind, tools: readonly ToolDef[]): ToolDef[] {
  return kind === 'code' ? [...tools] : tools.filter((tool) => tool.effect !== 'write' && tool.effect !== 'execute');
}

/**
 * What the model can reach. Several folders are all named, with the one
 * relative paths start from; with none, the tools still work on the home
 * folder — the model must neither demand a folder nor believe it cannot read.
 */
export function renderPerimeter(roots: readonly string[]): string {
  if (roots.length === 0) {
    return (
      'No project folder is open. Your tools still work inside the person’s home folder: relative paths ' +
      'resolve from it. Name the exact path you are about to touch when it matters.'
    );
  }
  if (roots.length === 1) {
    return (
      `Open project: ${roots[0]}\n` +
      'Relative paths resolve from this folder. Touching anything outside it needs the person’s approval.'
    );
  }
  return (
    'Open project, spanning several folders:\n' +
    roots.map((root, index) => (index === 0 ? `- ${root}  (default: relative paths resolve here)` : `- ${root}`)).join('\n') +
    '\nRelative paths resolve against the first folder; reach another one by its absolute path. ' +
    'Touching anything outside these folders needs the person’s approval.'
  );
}

export function buildSystemPrompt(options: SystemPromptOptions): SystemPrompt {
  const { family } = options;
  const head = [IDENTITY[options.kind], family.renderToolConvention(), AMENDMENT].filter((block) => block !== '');
  const stable = head.join('\n\n') + family.renderToolInventory(toolsFor(options.kind, options.tools));

  const project = [renderPerimeter(options.perimeter)];
  if (options.replyLanguage) project.push(`Write your replies to the person in ${options.replyLanguage}.`);
  if (options.projectInstructions) {
    project.push(`Project instructions:\n${neutralizeControlTokens(options.projectInstructions, family)}`);
  }
  return { stable, project: project.join('\n\n') };
}

/**
 * The system prompt of a conversation on a service (task 9.2): who bonaparte is, where it works, the language of
 * its replies and the project's instructions. No tool convention nor inventory: the service is handed the tools
 * by its own API. Sent whole at every turn — nothing is frozen there, the service keeps no memory.
 */
export function buildServicePrompt(options: Omit<SystemPromptOptions, 'family' | 'tools'>): string {
  const blocks = [IDENTITY[options.kind], renderPerimeter(options.perimeter)];
  if (options.replyLanguage) blocks.push(`Write your replies to the person in ${options.replyLanguage}.`);
  if (options.projectInstructions) blocks.push(`Project instructions:\n${options.projectInstructions}`);
  return blocks.join('\n\n');
}
