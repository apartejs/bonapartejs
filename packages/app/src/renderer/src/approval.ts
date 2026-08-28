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
  always: string;
  refuse: string;
}

export function approvalOptions(t: ApprovalStrings): AparteApprovalOption[] {
  return [
    { value: 'allow', label: t.allow, tone: 'affirm' },
    { value: 'always', label: t.always },
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
  if (option === 'always') return { id, granted: true, always: true };
  return { id, granted: false };
}
