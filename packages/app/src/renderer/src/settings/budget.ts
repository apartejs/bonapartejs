/**
 * Lowering the disk budget under the usage (Settings, Engine and memory):
 * which memories go — the oldest saved first, never the one in the engine,
 * by conversation, and only as many as the budget needs. The core's
 * retention applies the same rule when it next saves.
 */

import type { MemoryRowView } from '@aparte/bonaparte-shared';

export function memoriesToFree(rows: readonly MemoryRowView[], usedBytes: number, budgetBytes: number): MemoryRowView[] {
  const freed: MemoryRowView[] = [];
  let used = usedBytes;
  for (const row of [...rows].filter((one) => one.state === 'saved' && one.bytes).sort((a, b) => a.at.localeCompare(b.at))) {
    if (used <= budgetBytes) break;
    freed.push(row);
    used -= row.bytes ?? 0;
  }
  return freed;
}
