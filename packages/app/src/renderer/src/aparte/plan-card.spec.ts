/**
 * What the plan card shows under aparté's steps: the files the plan touches
 * and the questions left to settle, read from the call's result — what it
 * cannot read is left out, never drawn half.
 */

import type { AparteToolCallSegment } from '@aparte/core';
import { describe, expect, it } from 'vitest';
import { planExtras } from './plan-card';

const segment = (status: AparteToolCallSegment['status'], structuredResult?: unknown): AparteToolCallSegment =>
  ({ type: 'tool_call', toolCall: { id: 't1', name: 'update_plan', input: {} }, status, structuredResult }) as AparteToolCallSegment;

describe('planExtras', () => {
  it('reads the files and the questions of a finished plan', () => {
    const extras = planExtras(
      segment('resolved', {
        steps: [],
        files: [{ path: 'src/csv.ts', change: 'new' }, { path: 'a.ts', change: 'renamed' }, 'b.ts'],
        questions: ['Le séparateur.', 4],
      }),
    );
    expect(extras).toEqual({ files: [{ path: 'src/csv.ts', change: 'new' }], questions: ['Le séparateur.'] });
  });

  it('shows nothing under a plan still being written, or without them', () => {
    expect(planExtras(segment('pending', { files: [{ path: 'a.ts', change: 'new' }] }))).toEqual({ files: [], questions: [] });
    expect(planExtras(segment('resolved', { steps: [] }))).toEqual({ files: [], questions: [] });
  });
});
