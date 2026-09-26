/**
 * Figures of the honest gauge (P2.8), kept out of the components so they
 * are tested as figures.
 */

import type { PromptProgressDto } from '@aparte/bonaparte-shared';

/**
 * About how long the prefill still takes, from the speed of THIS prefill:
 * the tokens it computed (cached ones cost nothing) over the time it took.
 * Null until that speed is measurable, and once everything is read.
 */
export function prefillRemainingMs(progress: PromptProgressDto): number | null {
  const computed = progress.processed - progress.cache;
  const left = progress.total - progress.processed;
  if (computed <= 0 || progress.timeMs <= 0 || left <= 0) return null;
  return Math.round(left / (computed / progress.timeMs));
}

/** A duration at the scale of the wait: ms, tenths of a second, seconds, then minutes. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes >= 10 || rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
