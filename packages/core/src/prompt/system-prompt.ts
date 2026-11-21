/**
 * The system prompt of a conversation, in two system turns. Everything in it
 * is English: it is a protocol, and models are trained on English
 * instructions and tool calls. The reply language is an instruction of its
 * own.
 *
 *   1. `stable` — identity and method (the machine's platform in it), how to
 *      call a tool, the amendment clause, then the tools, where the family's
 *      template puts them (Gemma: its declarations close the turn). The same
 *      for every conversation of a kind on a model and a machine: a seed of
 *      this turn serves them all (spec §7.2).
 *   2. `project` — this conversation's decor: the project's folders (the
 *      first is the default), its environment (the date, the branch, what is
 *      not committed), the reply language, the project's instructions.
 *
 * Both are frozen when the conversation is created; a later change is a
 * delta appended to the journal (`deltas.ts`), never a re-render. The order
 * is baked into every KV state saved: changing it invalidates them all.
 */

import { neutralizeControlTokens } from '../families/control-tokens.js';
import { disarmForService } from '../families/service-tokens.js';
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
  /** The machine's platform (« Windows »): the same for every conversation of the machine, in the shared turn. */
  platform?: string;
  /** This conversation's environment, rendered (`renderEnvironment`): the date, the branch, what is not committed. */
  environment?: string;
}

export interface SystemPrompt {
  stable: string;
  project: string;
}

/**
 * Who the model is and how it works (audit 2026-11-21, I1): a small model needs the method more than a large one —
 * find, read before an edit, check, never repeat a failure, no shell, how to end. Short: it rides in every prompt.
 */
const IDENTITY: Record<ConversationKind, (platform: string | undefined) => string> = {
  code: (platform) =>
    [
      `You are bonaparte, a coding agent working in the user’s project on their computer${platform ? ` (${platform})` : ''}. ` +
        'You act through tool calls; the user sees each call and may have to approve it.',
      'How to work:',
      '- Find before you read: search and list_files, then read_file only the part you need (offset and limit for a long file).',
      '- Read a file before you edit it, and copy old_string exactly from what read_file showed.',
      '- edit_file changes an existing file; write_file only creates a file or replaces a whole file.',
      '- Change only what the task needs. Never commit, push or delete unless the user asks.',
      '- After a change, check it: run the project’s tests, build or linter with run_command when it has them.',
      '- If a call fails, read the error and fix the call: never repeat it unchanged. After two failures, stop and tell the user what blocks you.',
      '- If the user refuses a call, do not try it again: follow their reason, or ask what they want instead.',
      '- run_command has no shell: give the program, then each argument apart (no &&, |, > or *). Use list_files, read_file and search rather than ls, cat or grep.',
      'End with a short message: what you changed, how you checked it, what is left.',
    ].join('\n'),
  discussion: (platform) =>
    [
      `You are bonaparte, an assistant on the user’s computer${platform ? ` (${platform})` : ''}. ` +
        'In this conversation you have no folder: you reach none of their files and run nothing. You answer from what you know, and from the web when a tool lets you.',
      'How to work:',
      '- For anything recent, or that you are not sure of, search the web, then read the best result before you answer.',
      '- web_fetch reads the text of a page; browser_open opens a page in your own browser tab, to see it run or act on it.',
      '- When a fact comes from a page you read, give its address.',
      '- If a call fails, read the error and change the call: never repeat it unchanged.',
      'Be precise and concise.',
    ].join('\n'),
};

// Without it, a delta appended later would contradict the frozen prompt.
const AMENDMENT =
  'The list of tools may be amended later in this conversation: an update will announce any tool added or ' +
  'removed, and it takes precedence over the list given here.';

/** The built-in browser's tools a discussion has: its pages, never a file (Paul, 2026-11-20). */
const DISCUSSION_BROWSER = new Set(['browser_open', 'browser_read', 'browser_screenshot', 'browser_act']);

/**
 * A discussion reaches no file and runs nothing — the web only, as a conversation without a folder does in the
 * other assistants (task 9.7), and the whole built-in browser on web pages (Paul, 2026-11-20: its act asked each
 * time); its questions are the window's. A code conversation has every tool. A tool kept only for conversations
 * told of it before (`hidden`) is told to none.
 */
export function toolsFor(kind: ConversationKind, tools: readonly ToolDef[]): ToolDef[] {
  const told = tools.filter((tool) => !tool.hidden);
  if (kind === 'code') return told;
  // An MCP tool is never a discussion's, whatever its effect: a server's « read-only » tool reads this machine's files.
  return told.filter(
    (tool) => (tool.effect === 'network' && tool.source !== 'mcp') || (tool.source === 'plugin' && DISCUSSION_BROWSER.has(tool.name)),
  );
}

/**
 * What the model can reach. Several folders are all named, with the one
 * relative paths start from; with none, the tools still work on the home
 * folder — the model must neither demand a folder nor believe it cannot read.
 */
export function renderPerimeter(roots: readonly string[]): string {
  if (roots.length === 0) {
    return (
      'No project folder is open. Your tools still work inside the user’s home folder: relative paths ' +
      'resolve from it. Name the exact path you are about to touch when it matters.'
    );
  }
  if (roots.length === 1) {
    return (
      `Open project: ${roots[0]}\n` +
      'Relative paths resolve from this folder. Touching anything outside it needs the user’s approval.'
    );
  }
  return (
    'Open project, spanning several folders:\n' +
    roots.map((root, index) => (index === 0 ? `- ${root}  (default: relative paths resolve here)` : `- ${root}`)).join('\n') +
    '\nRelative paths resolve against the first folder; reach another one by its absolute path. ' +
    'Touching anything outside these folders needs the user’s approval.'
  );
}

export function buildSystemPrompt(options: SystemPromptOptions): SystemPrompt {
  const { family } = options;
  const head = [IDENTITY[options.kind](options.platform), family.renderToolConvention(), AMENDMENT].filter((block) => block !== '');
  const stable = head.join('\n\n') + family.renderToolInventory(toolsFor(options.kind, options.tools));

  // A discussion has no folder: its own turn names none (its method says so), never a home folder to work in.
  const project = options.kind === 'discussion' ? [] : [renderPerimeter(options.perimeter)];
  if (options.environment) project.push(options.environment);
  if (options.replyLanguage) project.push(`Write your replies to the user in ${options.replyLanguage}.`);
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
  const blocks = [IDENTITY[options.kind](options.platform), ...(options.kind === 'discussion' ? [] : [renderPerimeter(options.perimeter)])];
  // The branch and the file names are a repository's choice: disarmed as its instructions are (security rule 5).
  if (options.environment) blocks.push(disarmForService(options.environment));
  if (options.replyLanguage) blocks.push(`Write your replies to the user in ${options.replyLanguage}.`);
  // A file anyone who commits wrote: disarmed for any family the service may run (audit 13.4).
  if (options.projectInstructions) blocks.push(`Project instructions:\n${disarmForService(options.projectInstructions)}`);
  return blocks.join('\n\n');
}
