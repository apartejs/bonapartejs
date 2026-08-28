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
};

describe('approval on the library panel', () => {
  it('offers the three decisions the harness can honour, allow first', () => {
    // The options travel with the request (the library fixes none): a gate
    // that can remember a grant offers three, and the labels are ours.
    const options = approvalOptions(EN.approval);

    expect(options.map((o) => o.value)).toEqual(['allow', 'always', 'refuse']);
    expect(options.map((o) => o.label)).toEqual(['Allow', 'Always allow', 'Refuse']);
    expect(options[0]?.tone).toBe('affirm');
    expect(options[2]?.tone).toBe('deny');
    expect(options[1]?.tone).toBeUndefined();
  });

  it('names the tool and what it is about to do', () => {
    expect(approvalMessage(EN.approval, request)).toBe(
      'bonaparte wants to act on your machine — run_shell · pnpm test',
    );
    expect(
      approvalMessage(EN.approval, { ...request, command: undefined, args: { path: 'src/a.ts' } }),
    ).toBe('bonaparte wants to act on your machine — run_shell · src/a.ts');
  });

  it('maps an accepted option to the harness response', () => {
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'allow' } })).toEqual({
      id: 'req-1',
      granted: true,
    });
    expect(answerToResponse('req-1', { action: 'accept', content: { option: 'always' } })).toEqual({
      id: 'req-1',
      granted: true,
      always: true,
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
