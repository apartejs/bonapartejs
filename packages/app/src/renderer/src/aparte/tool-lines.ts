/**
 * The line of a tool's call in a reply (board « Conversation au travail »):
 * a word in the tense of the call — « Lit » while it runs, « Lu » once done,
 * « Lire » while it waits or when it failed —, its target (a path, a
 * pattern, a command), and what it did, read from the facts the core gives
 * the window beside the result (`structuredContent`: lines, matches, exit
 * code). An edit or a write keeps its change behind its line, opened
 * (aparté's `setupDiff`); a command keeps what it printed.
 *
 * aparté holds one tool-line provider per config: the one this sets answers
 * for the core's tools only, and hands every other call to the one it found.
 */

import { aparteGlobalConfig, type AparteConfig, type AparteToolCallSegment } from '@aparte/core';
import { folderIcon, globeIcon, searchIcon } from '@aparte/core/icons';
import { setupDiff } from '@aparte/plugin-diff';
import type { Messages } from '../i18n/index';
import type { ToolLineName } from '../i18n/types';

const NAMES: readonly ToolLineName[] = ['read_file', 'list_files', 'search', 'edit_file', 'write_file', 'run_command', 'web_fetch'];

const ICONS: Record<ToolLineName, string> = {
  read_file: 'file',
  list_files: 'folder',
  search: 'search',
  edit_file: 'edit',
  write_file: 'edit',
  run_command: 'terminal',
  web_fetch: 'globe',
};

const isLine = (name: string): name is ToolLineName => (NAMES as readonly string[]).includes(name);
const inputOf = (segment: AparteToolCallSegment): Record<string, unknown> => (segment.toolCall?.input ?? {}) as Record<string, unknown>;
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What the call is about: what the model asked for, as it asked it. */
const TARGETS: Record<ToolLineName, (input: Record<string, unknown>) => string> = {
  read_file: (input) => textOf(input['path']),
  list_files: (input) => textOf(input['path']) || '.',
  search: (input) => textOf(input['pattern']),
  edit_file: (input) => textOf(input['path']),
  write_file: (input) => textOf(input['path']),
  run_command: (input) => {
    const args = Array.isArray(input['args']) ? input['args'].map((arg) => String(arg)) : [];
    return [textOf(input['program']), ...args].filter((part) => part !== '').join(' ');
  },
  web_fetch: (input) => textOf(input['url']),
};

/** What the call did, after its target — from the facts of a finished call, else nothing. */
export function toolNote(segment: AparteToolCallSegment, messages: Messages): string | undefined {
  const name = segment.toolCall?.name ?? '';
  if (!isLine(name) || segment.status !== 'resolved') return undefined;
  const facts = segment.structuredResult;
  if (typeof facts !== 'object' || facts === null) return undefined;
  const fact = facts as Record<string, unknown>;
  const count = (key: string): number | undefined => (typeof fact[key] === 'number' ? (fact[key] as number) : undefined);
  const words = messages.tools;
  switch (name) {
    case 'read_file': {
      const lines = count('lines');
      return lines === undefined ? undefined : words.lines(lines);
    }
    case 'list_files': {
      const entries = count('entries');
      return entries === undefined ? undefined : words.entries(entries);
    }
    case 'search': {
      const matches = count('matches');
      return matches === undefined ? undefined : words.matches(matches, fact['more'] === true);
    }
    case 'run_command': {
      if (fact['stopped'] === 'time') return words.timedOut;
      if (fact['stopped'] === 'stop') return words.stopped;
      const code = count('exitCode');
      return code === undefined || code === 0 ? undefined : words.exitCode(code);
    }
    case 'write_file':
      return fact['created'] === true ? words.created : undefined;
    default:
      return undefined;
  }
}

/** What a command printed, behind its line: its text, never its markup. */
function printed(segment: AparteToolCallSegment, held?: HTMLElement): HTMLElement | string {
  if (segment.status !== 'resolved' || typeof document === 'undefined' || !segment.result) return '';
  const block = held ?? document.createElement('pre');
  block.className = 'tool-output';
  if (block.textContent !== segment.result) block.textContent = segment.result;
  return block;
}

/** Gives the core's tools their lines; the function returned takes them back. */
export function registerToolLines(messages: Messages, config: AparteConfig = aparteGlobalConfig): () => void {
  config.registerIcons({ search: () => searchIcon, globe: () => globeIcon, folder: () => folderIcon });
  // aparté's word for a call that waits for the person, said the way bonaparte speaks.
  config.extendLocale({ approvalWaiting: messages.tools.waiting });

  for (const name of NAMES) {
    const words = messages.tools.labels[name];
    config.registerToolDisplay(name, {
      label: (segment) => (segment.status === 'pending' ? words.running : segment.status === 'resolved' ? words.done : words.name),
      icon: ICONS[name],
      summary: (segment) => TARGETS[name](inputOf(segment)),
      details: name === 'run_command' ? printed : false,
    });
  }
  const stopDiff = setupDiff(
    {
      tool: ['edit_file', 'write_file'],
      map: (result: unknown) => {
        const diff = typeof result === 'object' && result !== null ? (result as { diff?: unknown }).diff : undefined;
        return typeof diff === 'string' ? diff : null;
      },
    },
    config,
  );

  const previous = config.getToolLineProvider();
  config.setToolLineProvider((segment) => {
    const note = toolNote(segment, messages);
    return note !== undefined ? { note } : (previous?.(segment) ?? undefined);
  });

  return () => {
    stopDiff();
    for (const name of NAMES) config.unregisterToolDisplay(name);
    config.setToolLineProvider(previous);
  };
}
