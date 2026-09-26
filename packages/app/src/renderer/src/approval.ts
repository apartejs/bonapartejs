/**
 * The approval of a tool call, on the library's panel.
 *
 * The decision is the harness's (play modes, remembered rules); the panel
 * is apartéJS's — the same one it uses for its own approvals, inline in the
 * composer, where the answer is typed. The library fixes no option: the
 * requester writes them, because only it knows what it can honour. Ours
 * are three, because the harness has somewhere to remember a grant.
 */

import type { AparteApprovalOption, AparteElicitationResult } from '@aparte/core';
import type { ApprovalRequestDto, ApprovalResponseDto } from '@aparte/bonaparte-shared';

export interface ApprovalStrings {
  title: string;
  allow: string;
  refuse: string;
  alwaysCommand: string;
  /** `{binary}`: the program. */
  alwaysBinary: string;
  alwaysBinaryHint: string;
  /** `{tool}`: the tool's name. */
  alwaysTool: string;
  alwaysToolHint: string;
}

/**
 * The decisions the harness can honour. An "always" says what it covers
 * (Q-24, audit C1), on the option's second line: for a command, the exact
 * line — or, when its program is a plain name, every command of that
 * program; for any other tool, the tool.
 */
export function approvalOptions(t: ApprovalStrings, request: ApprovalRequestDto): AparteApprovalOption[] {
  const always: AparteApprovalOption[] =
    request.command !== undefined
      ? [
          { value: 'always-command', label: t.alwaysCommand, description: request.command.trim() },
          ...(request.binary
            ? [
                {
                  value: 'always-binary',
                  label: t.alwaysBinary.replace('{binary}', () => request.binary),
                  description: t.alwaysBinaryHint.replaceAll('{binary}', request.binary),
                },
              ]
            : []),
        ]
      : [
          {
            value: 'always',
            label: t.alwaysTool.replace('{tool}', () => request.tool),
            description: t.alwaysToolHint,
          },
        ];
  return [
    { value: 'allow', label: t.allow, tone: 'affirm' },
    ...always,
    { value: 'refuse', label: t.refuse, tone: 'deny' },
  ];
}

/** Readable preview of what the agent is about to do. */
function preview(request: ApprovalRequestDto): string {
  if (request.command) return request.command;
  const path = request.args['path'];
  if (typeof path === 'string') return path;
  return JSON.stringify(request.args);
}

export function approvalMessage(t: ApprovalStrings, request: ApprovalRequestDto): string {
  return `${t.title} — ${request.tool} · ${preview(request)}`;
}

/**
 * What the panel resolved with, as the harness's answer. Fail-safe: a
 * decline, free text alone, or a shape we do not know is a refusal.
 */
export function answerToResponse(id: string, result: AparteElicitationResult): ApprovalResponseDto {
  if (result.action !== 'accept') return { id, granted: false };
  const content = result.content;
  const option =
    typeof content === 'object' && content !== null && 'option' in content
      ? (content as { option?: unknown }).option
      : undefined;
  if (option === 'allow') return { id, granted: true };
  if (option === 'always' || option === 'always-command') return { id, granted: true, always: 'command' };
  if (option === 'always-binary') return { id, granted: true, always: 'binary' };
  return { id, granted: false };
}
