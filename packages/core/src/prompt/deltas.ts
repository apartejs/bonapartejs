/**
 * What changed since the system prompt was frozen, as notes appended to the
 * conversation — never a re-render (spec §7.3, §7.11). Each says only what
 * moved, and there is none when nothing did. English, like everything the
 * model reads; the family disarms the control tokens when it writes the note
 * (`renderSystemNote`). The next rebase folds them into the system prompt.
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import type { Delta } from '../journal/types.js';
import type { ToolDef } from '../tools/types.js';

/** A tool as a delta lists it: the family's declarations live in the frozen prompt only. */
function toolLine(tool: ToolDef): string {
  return `- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The project's folders moved. The order matters as much as the content:
 * the first folder is the default for relative paths.
 */
export function renderPerimeterDelta(previous: readonly string[], current: readonly string[]): Delta | null {
  if (sameList(previous, current)) return null;
  if (current.length === 0) {
    return {
      kind: 'perimeter',
      text:
        '[project update]\nThe project folders were closed. Your tools still work inside the person’s home ' +
        'folder: relative paths resolve from it. Name the exact path you are about to touch.',
    };
  }
  const added = current.filter((root) => !previous.includes(root));
  const removed = previous.filter((root) => !current.includes(root));
  const parts = [
    '[project update]',
    'The project now spans these folders:',
    current.map((root, index) => (index === 0 ? `- ${root}  (default for relative paths)` : `- ${root}`)).join('\n'),
  ];
  if (added.length > 0) parts.push(`Added: ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`Removed (do not touch them any more): ${removed.join(', ')}`);
  parts.push('This list supersedes anything said earlier about the project folders.');
  return { kind: 'perimeter', text: parts.join('\n') };
}

/** Tools added, changed or removed: one message for all of it. */
export function renderInventoryDelta(previous: readonly ToolDef[], current: readonly ToolDef[]): Delta | null {
  const before = new Map(previous.map((tool) => [tool.name, toolLine(tool)]));
  const available = current.filter((tool) => before.get(tool.name) !== toolLine(tool));
  const names = new Set(current.map((tool) => tool.name));
  const removed = previous.filter((tool) => !names.has(tool.name)).map((tool) => tool.name);
  if (available.length === 0 && removed.length === 0) return null;
  const parts = ['[tool inventory update]'];
  if (available.length > 0) parts.push(`Tools now available:\n${available.map(toolLine).join('\n')}`);
  if (removed.length > 0) parts.push(`Tools removed (do not call them): ${removed.join(', ')}`);
  return { kind: 'inventory', text: parts.join('\n') };
}

/** The project's instructions changed on disk: the new text, in full. */
export function renderInstructionsDelta(previous: string | undefined, current: string | undefined): Delta | null {
  if ((previous ?? '') === (current ?? '')) return null;
  if (!current) {
    return {
      kind: 'instructions',
      text: '[project update]\nThe project instructions no longer exist: disregard the ones given earlier.',
    };
  }
  return { kind: 'instructions', text: `[project update]\nThe project instructions changed. They now read:\n${current}` };
}

/** The person changed the language of the interface: the replies follow it. */
export function renderReplyLanguageDelta(previous: string | undefined, current: string): Delta | null {
  if (previous === current) return null;
  return { kind: 'reply-language', text: `[preferences update]\nWrite your replies to the person in ${current}.` };
}

/** What each mode lets the model do, as it reads it: the product's name, then what runs and what is asked. */
const MODE_NOTES: Record<PlayMode, string> = {
  lecture:
    'Lecture: the person reads your plan before anything changes. Read what you need, then present the change as a plan with update_plan — ' +
    'its steps, the files it touches, the questions to settle on the way. Write nothing and run nothing: such calls are refused. ' +
    'The person launches the plan when it suits them.',
  repetition:
    'Répétition: every change to a file and every command is asked to the person before it runs. Go ahead with the work; ' +
    'a refusal may come with what to do instead.',
  plume: 'Plume: changes to files run without asking; commands are asked to the person. Go ahead with the work.',
  impro:
    'Impro: changes and commands run without asking, except files that run later (package.json, git hooks, configuration files, .env), ' +
    'which are always asked.',
};

/** Leaving Lecture for a mode that changes things is the person launching the plan the model presented. */
const LAUNCHED =
  'The person launched your plan: send update_plan again with its first step in-progress, then carry the plan out, ' +
  'sending update_plan each time a step moves.';

/** The mode the conversation runs in, when it is not the one the model was last told; `launched`: it leaves Lecture with a plan. */
export function renderModeDelta(mode: PlayMode, launched = false): Delta {
  return { kind: 'mode', mode, text: `[mode] ${MODE_NOTES[mode]}${launched ? `\n${LAUNCHED}` : ''}` };
}
