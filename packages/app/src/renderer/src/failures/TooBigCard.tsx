/**
 * A model too big for the card (task 12.3, board « Quand quelque chose casse », « Avant de charger »): what it
 * needs, what the card has, and nothing loaded before the person chooses — part of it on the processor (the layers
 * that fit, said slower), or another model.
 */

import type { Messages } from '../i18n/index';
import { formatBytes, type NumberStyle } from '../format';
import { FailureCard, type FailureAction } from './FailureCard';

export interface TooBigCardProps {
  messages: Messages;
  style: NumberStyle;
  model: string;
  tooBig: { neededBytes: number; gpuBytes: number; gpuLayers: number | null };
  busy: boolean;
  onOffload(): void;
  onSmaller(): void;
}

export function TooBigCard({ messages, style, model, tooBig, busy, onOffload, onSmaller }: TooBigCardProps) {
  const words = messages.failures.tooBig;
  const actions: FailureAction[] = [
    ...(tooBig.gpuLayers !== null ? [{ label: words.offload, run: onOffload, busy, weight: 'primary' as const }] : []),
    { label: words.smaller, run: onSmaller, disabled: busy, weight: tooBig.gpuLayers !== null ? ('secondary' as const) : ('primary' as const) },
  ];
  return (
    <FailureCard
      tone="warning"
      context={words.context}
      title={words.title}
      headline={words.headline(formatBytes(tooBig.neededBytes, style), formatBytes(tooBig.gpuBytes, style))}
      detail={tooBig.gpuLayers === null ? `${words.detail(model)} ${words.noOffload}` : words.detail(model)}
      actions={actions}
    />
  );
}
