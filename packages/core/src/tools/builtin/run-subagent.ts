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
    description:
      'Hand an independent piece of work to a sub-agent: it works with a context of its own and the tools you give it, ' +
      'then returns only its result, which you read here. Use it for separate leads you can follow independently ' +
      '(reading logs, exploring part of the code, measuring something), and give each a complete mission: the sub-agent ' +
      'sees nothing of this conversation. Several calls in one step run one after another.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short name for the sub-agent, shown to the person: "Log reader".' },
        mission: { type: 'string', description: 'What to do, what to look at, and what to give back: complete on its own.' },
        tools: {
          type: 'string',
          enum: ['read', 'all'],
          description: '"read": read files and search only (the default). "all": it may also edit files and run commands, asked as yours are.',
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
