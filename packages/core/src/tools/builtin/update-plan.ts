/**
 * update_plan: the plan the model works through, sent again each time a step
 * moves. Its structured result is what aparté's plan card reads — a title and
 * steps with their status — and the model gets one line back. It touches
 * nothing (effect `ui`).
 */

import { refused, type BuiltinTool } from './common.js';

const STATUSES = ['pending', 'in-progress', 'done', 'failed', 'skipped', 'blocked'] as const;
type PlanStatus = (typeof STATUSES)[number];

interface PlanStep {
  title: string;
  status: PlanStatus;
  detail?: string;
}

const CHANGES = ['new', 'modified', 'deleted'] as const;
type FileChange = (typeof CHANGES)[number];

/** A file the plan touches: its path and what happens to it. Anything else is left out. */
function readFile(raw: unknown): { path: string; change: FileChange } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { path, change } = raw as Record<string, unknown>;
  if (typeof path !== 'string' || path.trim() === '' || !CHANGES.includes(change as FileChange)) return null;
  return { path, change: change as FileChange };
}

function readStep(raw: unknown): PlanStep | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { title, status, detail } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (!STATUSES.includes(status as PlanStatus)) return null;
  return { title, status: status as PlanStatus, ...(typeof detail === 'string' && detail !== '' ? { detail } : {}) };
}

export const updatePlan: BuiltinTool = {
  def: {
    name: 'update_plan',
    description:
      'Show the plan you work through, and send it again each time a step moves. ' +
      `Each step has a title and a status: ${STATUSES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the plan is for.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              status: { type: 'string', enum: [...STATUSES] },
              detail: { type: 'string', description: 'A word on the step: a file, why it failed.' },
            },
            required: ['title', 'status'],
          },
        },
        files: {
          type: 'array',
          description: 'The files the plan touches.',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, change: { type: 'string', enum: [...CHANGES] } },
            required: ['path', 'change'],
          },
        },
        questions: {
          type: 'array',
          description: 'What is left to settle on the way, each in a sentence: you will ask the user when it comes.',
          items: { type: 'string' },
        },
      },
      required: ['steps'],
    },
    effect: 'ui',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call) => {
    const input = typeof call.input === 'object' && call.input !== null ? (call.input as Record<string, unknown>) : {};
    const raw = input['steps'];
    if (!Array.isArray(raw) || raw.length === 0) return refused('The plan needs steps: a list of { title, status }.');
    const steps = raw.map(readStep);
    if (steps.some((step) => step === null)) {
      return refused(`Each step needs a title and a status among: ${STATUSES.join(', ')}.`);
    }
    const kept = steps as PlanStep[];
    const title = typeof input['title'] === 'string' && input['title'] !== '' ? input['title'] : undefined;
    const done = kept.filter((step) => step.status === 'done').length;
    // What the card shows under the steps: a file or a question it cannot read is left out, never refused.
    const files = Array.isArray(input['files']) ? input['files'].map(readFile).filter((file) => file !== null) : [];
    const questions = Array.isArray(input['questions'])
      ? input['questions'].filter((question): question is string => typeof question === 'string' && question.trim() !== '')
      : [];
    return {
      content: `Plan updated: ${kept.length} steps, ${done} done.`,
      structuredContent: {
        ...(title ? { title } : {}),
        steps: kept,
        ...(files.length > 0 ? { files } : {}),
        ...(questions.length > 0 ? { questions } : {}),
      },
    };
  },
};
