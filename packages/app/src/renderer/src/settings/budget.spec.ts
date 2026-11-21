/**
 * Lowering the disk budget under the usage (Settings, Engine and memory):
 * the memories that go are chosen by their conversation — never by a title
 * two conversations can share —, the oldest saved first, never the one in
 * the engine, and only as many as the budget needs.
 */

import type { MemoryRowView } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { memoriesToFree } from './budget';

const GIB = 1024 ** 3;
const row = (id: string, title: string, at: string, state: MemoryRowView['state'] = 'saved'): MemoryRowView => ({
  id,
  title,
  projectId: null,
  state,
  tokens: 1000,
  bytes: GIB,
  at,
  otherModel: false,
  otherSlots: false,
  rereadSeconds: null,
});

describe('the memories a lower budget lets go', () => {
  it('takes the oldest saved first, by conversation, and no more than needed', () => {
    const rows = [row('a', 'Bonjour', '2026-11-10T00:00:00Z'), row('b', 'Bonjour', '2026-11-12T00:00:00Z'), row('c', 'Autre', '2026-11-11T00:00:00Z')];
    expect(memoriesToFree(rows, 3 * GIB, 2 * GIB).map((one) => one.id)).toEqual(['a']);
    expect(memoriesToFree(rows, 3 * GIB, 1 * GIB).map((one) => one.id)).toEqual(['a', 'c']);
  });

  it('never the memory in the engine, nothing when the budget holds the usage', () => {
    const rows = [row('e', 'En cours', '2026-11-01T00:00:00Z', 'engine'), row('s', 'Sauvée', '2026-11-02T00:00:00Z')];
    expect(memoriesToFree(rows, 2 * GIB, 1 * GIB).map((one) => one.id)).toEqual(['s']);
    expect(memoriesToFree(rows, 2 * GIB, 3 * GIB)).toEqual([]);
  });
});
