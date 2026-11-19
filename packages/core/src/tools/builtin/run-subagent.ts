/**
 * run_subagent (task 8.1): the model hands an independent piece of work to a
 * sub-agent — its own context, the tools it is given, never more than its
 * conversation may — and reads only its result. The agent's loop runs it
 * (`agent/subagents.ts`): it needs the slot its conversation holds, which only
 * the loop can lend. Its effect is `ui`: allowed in every mode — what the
 * sub-agent does is decided call by call, under the conversation's mode — and
 * it never waits in the line of its conversation's writes, which its own
 * sub-agent's writes go through.
 */

import { refused, type BuiltinTool } from './common.js';

export const RUN_SUBAGENT = 'run_subagent';

export interface SubagentSpec {
  /** A short name, shown to the person (« Lecteur de logs »). */
  name: string;
  /** What to do, and what to give back. */
  mission: string;
  /** `read`: read and search only; `all`: also edit files and run commands, asked as the conversation's own. */
  tools: 'read' | 'all';
}

/** The call's input as a sub-agent's spec, or what is wrong with it — said to the model. */
export function readSubagentSpec(input: unknown): SubagentSpec | { error: string } {
  if (typeof input !== 'object' || input === null) return { error: 'run_subagent needs a name, a mission and its tools.' };
  const { name, mission, tools } = input as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') return { error: 'run_subagent needs a short name for the sub-agent.' };
  if (typeof mission !== 'string' || mission.trim() === '') return { error: 'run_subagent needs a mission: what to do, and what to give back.' };
  if (tools !== undefined && tools !== 'read' && tools !== 'all') return { error: 'run_subagent: tools is "read" or "all".' };
  return { name: name.trim().slice(0, 60), mission: mission.trim(), tools: tools === 'all' ? 'all' : 'read' };
}

export const runSubagentTool: BuiltinTool = {
  def: {
    name: RUN_SUBAGENT,
    // Paid in every conversation's prompt: said briefly.
    description:
      'Hand an independent lead to a sub-agent with its own context; you read only its result. ' +
      'Its mission must be complete: it sees nothing of this conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name shown to the person.' },
        mission: { type: 'string', description: 'What to do and what to give back.' },
        tools: {
          type: 'string',
          enum: ['read', 'all'],
          description:
            '"read" (default): it reads and searches only. "all": it may also write and edit files and run commands — give "all" whenever the mission writes a file or runs a command.',
        },
      },
      required: ['name', 'mission'],
    },
    effect: 'ui',
    source: 'builtin',
    where: 'core',
  },
  // The agent's loop runs it; a registry that is asked directly has no slot to lend.
  handler: async () => refused('run_subagent runs only in the agent loop.'),
};
