/**
 * What a project runs, through the bridge (task 10.3): the browser's new tab lists the scripts and services of
 * the project of the conversation shown, starts and stops them. The window names a conversation or a project,
 * never a folder nor a command; the core reads the project and launches.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const scope = z.object({ conversationId: z.string().min(1).max(128).optional(), projectId: z.string().min(1).max(128).optional() });
const name = z.string().min(1).max(200);

export const runViewSchema = z.object({
  kind: z.enum(['script', 'service']),
  name: z.string(),
  command: z.string(),
  state: z.enum(['stopped', 'running', 'exited']),
  url: z.string().nullable(),
  ready: z.literal(true).optional(),
  exitCode: z.number().nullable().optional(),
});

export type RunViewData = z.infer<typeof runViewSchema>;

export const runsList = defineChannel(
  'runs.list',
  scope,
  z.object({ projectName: z.string().nullable(), runs: z.array(runViewSchema), alreadyRunning: z.array(z.string()) }),
);
export const runsStart = defineChannel('runs.start', scope.extend({ kind: z.enum(['script', 'service']), name }), z.void());
export const runsStop = defineChannel('runs.stop', scope.extend({ name }), z.void());
