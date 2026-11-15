/**
 * update_plan: the plan the model works through, sent again each time a step
 * moves. Its structured result is what aparté's plan card reads
 * (`setupPlanCard({ tool: 'update_plan' })`): a title and steps, each with
 * its status. It touches nothing.
 */

import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../types.js';
import { updatePlan } from './update-plan.js';

const ctx: ToolContext = { conversationId: 'c1', roots: [], nCtx: 8_192, signal: new AbortController().signal };
const run = (input: unknown) => updatePlan.handler({ id: 't1', name: 'update_plan', input }, ctx);

describe('update_plan', () => {
  it("gives aparté's plan card its title and steps, and the model a line", async () => {
    const result = await run({
      title: 'Fix the decimal hours',
      steps: [
        { title: 'Read the parser', status: 'done' },
        { title: 'Write the failing test', status: 'in-progress' },
        { title: 'Fix the rounding', status: 'pending', detail: 'format.ts' },
      ],
    });
    expect(result.structuredContent).toEqual({
      title: 'Fix the decimal hours',
      steps: [
        { title: 'Read the parser', status: 'done' },
        { title: 'Write the failing test', status: 'in-progress' },
        { title: 'Fix the rounding', status: 'pending', detail: 'format.ts' },
      ],
    });
    expect(result.content).toBe('Plan updated: 3 steps, 1 done.');
  });

  it('refuses a plan without steps, or a step without a title or with an unknown status', async () => {
    expect(await run({ steps: [] })).toMatchObject({ failed: true });
    expect(await run({ steps: [{ status: 'done' }] })).toMatchObject({ failed: true });
    expect(await run({ steps: [{ title: 'x', status: 'maybe' }] })).toMatchObject({ failed: true });
  });

  it('is a tool of the interface: it writes nothing, runs nothing', () => {
    expect(updatePlan.def.effect).toBe('ui');
  });

  it('carries the files the plan touches and the questions to settle on the way, for the card under the plan', async () => {
    const result = await run({
      title: 'Export the recap',
      steps: [{ title: 'Write toCsv', status: 'pending' }],
      files: [
        { path: 'src/recap/csv.ts', change: 'new' },
        { path: 'src/ui/RecapHeader.tsx', change: 'modified' },
        { path: 'nowhere', change: 'renamed' },
        { change: 'new' },
      ],
      questions: ['The separator: semicolon or comma.', '', 3],
    });
    expect(result.structuredContent).toEqual({
      title: 'Export the recap',
      steps: [{ title: 'Write toCsv', status: 'pending' }],
      files: [
        { path: 'src/recap/csv.ts', change: 'new' },
        { path: 'src/ui/RecapHeader.tsx', change: 'modified' },
      ],
      questions: ['The separator: semicolon or comma.'],
    });
    expect(result.content).toBe('Plan updated: 1 steps, 0 done.');
  });
});

