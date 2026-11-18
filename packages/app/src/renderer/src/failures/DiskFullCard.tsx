/**
 * The disk nearly full (task 12.3, board « Quand quelque chose casse », « Disque »): said before the memory of the
 * conversation is saved — how much is free and where, and the oldest memories to let go, which will be read again.
 */

import type { Messages } from '../i18n/index';
import { formatBytes, type NumberStyle } from '../format';
import { FailureCard } from './FailureCard';

export interface DiskFullCardProps {
  messages: Messages;
  style: NumberStyle;
  check: { freeBytes: number; drive: string; release: string[] };
  busy: boolean;
  onRelease(): void;
  onChoose(): void;
}

export function DiskFullCard({ messages, style, check, busy, onRelease, onChoose }: DiskFullCardProps) {
  const words = messages.failures.diskFull;
  const count = check.release.length;
  return (
    <FailureCard
      tone="warning"
      context={words.context}
      title={words.title}
      headline={words.headline(formatBytes(check.freeBytes, style), check.drive)}
      detail={count > 0 ? words.detail(count) : words.nothing}
      actions={[
        ...(count > 0 ? [{ label: words.release(count), run: onRelease, busy }] : []),
        { label: words.choose, run: onChoose, disabled: busy, weight: count > 0 ? ('secondary' as const) : ('primary' as const) },
      ]}
    />
  );
}
