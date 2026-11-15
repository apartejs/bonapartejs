/**
 * The line of a tool's call in a reply, as the board « Conversation au
 * travail » draws it: a word in the tense of the call (« Lu », « Cherché »,
 * « Lancé »; « Modifier » while it waits for the person), its target, and
 * what it did, from the facts the core gives the window (« 12 lignes »,
 * « 3 résultats », « code de sortie 1 »). A write keeps its change behind
 * its line (aparté's `setupDiff`).
 */

import { aparteGlobalConfig, type AparteToolCallSegment } from '@aparte/core';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { registerToolLines } from './tool-lines';

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
});

function segment(name: string, input: Record<string, unknown>, status: AparteToolCallSegment['status'], structuredResult?: unknown): AparteToolCallSegment {
  return {
    type: 'tool_call',
    toolCall: { id: 't1', name, input },
    status,
    ...(structuredResult !== undefined ? { structuredResult } : {}),
  } as AparteToolCallSegment;
}

const label = (s: AparteToolCallSegment): string => {
  const shown = aparteGlobalConfig.getToolDisplay(s.toolCall.name)?.label;
  return typeof shown === 'function' ? shown(s) : String(shown);
};
const summary = (s: AparteToolCallSegment): string => String(aparteGlobalConfig.getToolDisplay(s.toolCall.name)?.summary?.(s));
// The note of a tool's own display (aparté 1.10): an empty one leaves the line to the providers.
const note = (s: AparteToolCallSegment): string | undefined => {
  const shown = aparteGlobalConfig.getToolDisplay(s.toolCall.name)?.note;
  return (typeof shown === 'function' ? shown(s) : shown) || undefined;
};

describe('registerToolLines', () => {
  it('says what a call does in the tense of the call: running, done, or by its name while it waits', () => {
    release = registerToolLines(fr);
    const read = (status: AparteToolCallSegment['status']) => segment('read_file', { path: 'src/format.ts' }, status);
    expect(label(read('pending'))).toBe('Lit');
    expect(label(read('resolved'))).toBe('Lu');
    expect(label(segment('edit_file', { path: 'src/format.ts' }, 'awaiting-approval'))).toBe('Modifier');
    expect(label(segment('search', { pattern: 'toDecimal' }, 'resolved'))).toBe('Cherché');
    expect(label(segment('run_command', { program: 'pnpm' }, 'resolved'))).toBe('Lancé');
  });

  it('names what the call is about: a path, a pattern, a command with its arguments', () => {
    release = registerToolLines(fr);
    expect(summary(segment('read_file', { path: 'src/format.ts' }, 'resolved'))).toBe('src/format.ts');
    expect(summary(segment('search', { pattern: 'toDecimal' }, 'resolved'))).toBe('toDecimal');
    expect(summary(segment('run_command', { program: 'pnpm', args: ['test', 'format'] }, 'resolved'))).toBe('pnpm test format');
    expect(summary(segment('web_fetch', { url: 'https://example.com/' }, 'resolved'))).toBe('https://example.com/');
  });

  it('says what it did, from the facts the core gave the window', () => {
    release = registerToolLines(fr);
    expect(note(segment('read_file', { path: 'a.ts' }, 'resolved', { lines: 12 }))).toBe('12 lignes');
    expect(note(segment('read_file', { path: 'a.ts' }, 'resolved', { lines: 1 }))).toBe('1 ligne');
    expect(note(segment('search', { pattern: 'x' }, 'resolved', { matches: 3, more: false }))).toBe('3 résultats');
    expect(note(segment('search', { pattern: 'x' }, 'resolved', { matches: 0, more: false }))).toBe('aucun résultat');
    expect(note(segment('run_command', { program: 'pnpm' }, 'resolved', { exitCode: 1 }))).toBe('code de sortie 1');
    expect(note(segment('run_command', { program: 'pnpm' }, 'resolved', { exitCode: 0 }))).toBeUndefined();
    expect(note(segment('run_command', { program: 'pnpm' }, 'resolved', { exitCode: null, stopped: 'time' }))).toBe('temps dépassé');
    expect(note(segment('write_file', { path: 'a.ts' }, 'resolved', { created: true, diff: '' }))).toBe('nouveau fichier');
    // Nothing yet while it runs; and nothing for a tool that is not the core's.
    expect(note(segment('read_file', { path: 'a.ts' }, 'pending'))).toBeUndefined();
    expect(note(segment('someone_else', {}, 'resolved', { lines: 3 }))).toBeUndefined();
  });

  it('speaks the language of the interface', () => {
    release = registerToolLines(en);
    expect(label(segment('read_file', { path: 'a.ts' }, 'resolved'))).toBe('Read');
    expect(note(segment('read_file', { path: 'a.ts' }, 'resolved', { lines: 12 }))).toBe('12 lines');
    expect(aparteGlobalConfig.t('approvalWaiting')).toBe(en.tools.waiting);
  });

  it('keeps a write\'s change behind its line, opened; a read has nothing behind its line', () => {
    release = registerToolLines(fr);
    expect(typeof aparteGlobalConfig.getToolDisplay('edit_file')?.details).toBe('function');
    expect(aparteGlobalConfig.getToolDisplay('edit_file')?.open).toBe(true);
    expect(typeof aparteGlobalConfig.getToolDisplay('write_file')?.details).toBe('function');
    expect(aparteGlobalConfig.getToolDisplay('read_file')?.details).toBe(false);
  });

  it('takes everything back when asked, and leaves the tool-line providers as it found them', () => {
    const plugin = (): undefined => undefined;
    const remove = aparteGlobalConfig.registerToolLineProvider(plugin);
    const providers = aparteGlobalConfig.getToolLineProviders();
    release = registerToolLines(fr);
    expect(aparteGlobalConfig.getToolLineProviders()).toEqual(providers);
    release();
    release = undefined;
    expect(aparteGlobalConfig.getToolDisplay('read_file')).toBeUndefined();
    expect(aparteGlobalConfig.getToolDisplay('edit_file')).toBeUndefined();
    expect(aparteGlobalConfig.getToolLineProviders()).toEqual(providers);
    remove();
  });
});
