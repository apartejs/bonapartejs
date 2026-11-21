/**
 * What the approval card names a call by — « Modifier `src/format.ts` ? »: the file of its preview, a command and its
 * arguments, else what its input names.
 */

import type { ToolPreviewView } from '@aparte/bonaparte-shared';
import type { ApprovalRequest } from '../aparte/approvals';

export function targetOf(request: Pick<ApprovalRequest, 'name' | 'input'>, preview: ToolPreviewView | null): string {
  const { input } = request;
  const text = (key: string): string | undefined => (typeof input[key] === 'string' ? (input[key] as string) : undefined);
  if (preview) return preview.path;
  if (request.name === 'run_command') {
    const args = Array.isArray(input['args']) ? input['args'].filter((arg): arg is string => typeof arg === 'string') : [];
    return [text('program') ?? '', ...args].join(' ').trim();
  }
  // An address before a path, as browser_open takes it: the card names what would leave the machine (review of round 3, 3).
  const url = text('url')?.trim();
  return url || (text('path') ?? request.name);
}
