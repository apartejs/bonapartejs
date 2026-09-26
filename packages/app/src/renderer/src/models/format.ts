import type { MemoryVerdictDto, ModelInfoDto } from '@aparte/bonaparte-shared';

/** 21.3 GiB, 640 MiB — the size a person reads, never a byte count. */
export function formatBytes(bytes: number, units: { gib: string; mib: string }): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} ${units.gib}`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} ${units.mib}`;
}

/** The memory a model will take at the engine's context — the file size when the header could not be read. */
export function modelFootprint(model: ModelInfoDto): number {
  return model.memory?.totalBytes ?? model.sizeBytes;
}

/** Tailwind text colour for a memory verdict: nothing to say, tight, will not fit. */
export function verdictTone(verdict: MemoryVerdictDto | undefined): string {
  if (verdict === 'too-big') return 'text-destructive';
  if (verdict === 'tight') return 'text-amber-700 dark:text-amber-300';
  return 'text-muted-foreground';
}
