import type { ApprovalRequestDto } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { answerToResponse, approvalMessage, approvalOptions } from './approval.js';
import { EN } from './i18n/en.js';

const request: ApprovalRequestDto = {
  id: 'req-1',
  conversationId: 'conv-a',
  tool: 'run_shell',
  args: { command: 'pnpm test' },
  command: 'pnpm test',
  binary: 'pnpm',
};

const describe_ = (option: { description?: string | (() => string) } | undefined): string | undefined =>
  typeof option?.description === 'function' ? option.description() : option?.description;

describe('approval on the library panel', () => {
  it('a command offers two scopes for "always": this exact line, or every command of its program', () => {
    // Q-24 / audit C1: "always allow" used to remember the first word — a
    // grant for `pnpm test` covered `pnpm exec rm -rf .`. Each scope now
    // says what it covers, on its option's second line.
    const options = approvalOptions(EN.approval, request);

    expect(options.map((o) => o.value)).toEqual(['allow', 'always-command', 'always-binary', 'refuse']);
    expect(options.map((o) => o.label)).toEqual([
      'Allow',
      'Always allow this command',
      'Always allow pnpm',
      'Refuse',
    ]);
    expect(describe_(options[1])).toBe('pnpm test');
    expect(describe_(options[2])).toMatch(/every pnpm command/i);
    expect(options[0]?.tone).toBe('affirm');
    expect(options[3]?.tone).toBe('deny');
  });

  it('a command whose program is not a plain name offers the exact line only', () => {
    const { binary: _none, ...unsafe } = { ...request, command: 'FOO=1 node x.js' };
    expect(approvalOptions(EN.approval, unsafe).map((o) => o.value)).toEqual([
      'allow',
      'always-command',
      'refuse',
    ]);
  });

  it('a tool without a command offers "always" for the tool', () => {
    const write: ApprovalRequestDto = {
      id: 'req-2',
      conversationId: 'conv-a',
      tool: 'edit_file',
      args: { path: 'src/a.ts' },
    };
    const options = approvalOptions(EN.approval, write);
    expect(options.map((o) => o.value)).toEqual(['allow', 'always', 'refuse']);
    expect(options[1]?.label).toBe('Always allow edit_file');
  });

  it('names a program as it is, even one that looks like a replacement pattern', () => {
    // `String.replace` reads `$&` in a replacement string as "the match":
    // a program named so would have been shown as "{binary}".
    const odd = { ...request, command: '$&tool --x', binary: '$&tool' };
    const labels = approvalOptions(EN.approval, odd).map((o) => (typeof o.label === 'function' ? o.label() : o.label));
    expect(labels.some((label) => label.includes('$&tool'))).toBe(true);
    expect(labels.some((label) => label.includes('{binary}'))).toBe(false);
  });

  it('names the tool and what it is about to do', () => {
    expect(approvalMessage(EN.approval, request)).toBe(
      'bonaparte wants to act on your machine — run_shell · pnpm test',
    );
    const { command: _c, ...pathOnly } = { ...request, args: { path: 'src/a.ts' } };
    expect(approvalMessage(EN.approval, pathOnly)).toBe(
      'bonaparte wants to act on your machine — run_shell · src/a.ts',
    );
  });

  it('maps an accepted option to the harness response, with the scope of an "always"', () => {
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'allow' } })).toEqual({
      id: 'req-1',
      granted: true,
    });
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'always-command' } })).toEqual({
      id: 'req-1',
      granted: true,
      always: 'command',
    });
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'always-binary' } })).toEqual({
      id: 'req-1',
      granted: true,
      always: 'binary',
    });
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'always' } })).toEqual({
      id: 'req-1',
      granted: true,
      always: 'command',
    });
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'refuse' } })).toEqual({
      id: 'req-1',
      granted: false,
    });
  });

  it('refuses on a decline, on free text alone, and on anything it does not know', () => {
    // Fail-safe: a decision the harness cannot read is a refusal.
    expect(answerToResponse('req-1', { action: 'decline' })).toEqual({ id: 'req-1', granted: false });
    expect(
      answerToResponse('req-1', { action: 'accept', content: { instruction: 'no, use pnpm' } }),
    ).toEqual({ id: 'req-1', granted: false });
    expect(answerToResponse('req-1', { action: 'accept', content: 'yes' })).toEqual({
      id: 'req-1',
      granted: false,
    });
  });
});
