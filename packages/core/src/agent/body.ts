/**
 * The body of a turn, as aparté's stock runner builds it
 * (`createAgentStreamRunner`): `{ v: 1, providerId?, messageId, request,
 * clientTools, resume? }`. Only what the core reads is checked; the rest of
 * the request travels untouched.
 */

import { z } from 'zod';

const contentPartSchema = z.looseObject({ type: z.string() });

const messageSchema = z.looseObject({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.union([z.string(), z.array(contentPartSchema)]),
});

export const agentBodySchema = z.object({
  v: z.literal(1),
  providerId: z.string().optional(),
  messageId: z.string().min(1),
  request: z.looseObject({
    messages: z.array(messageSchema),
    modelId: z.string().optional(),
    // What the history opens with in place of the turns before its checkpoint (aparté 1.11).
    _meta: z.looseObject({ historySummary: z.string().optional() }).optional(),
  }),
  clientTools: z.array(z.looseObject({ name: z.string() })).default([]),
  resume: z
    .object({
      ticket: z.string(),
      outcomes: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});

export type AgentBody = z.infer<typeof agentBodySchema>;
export type AgentMessage = AgentBody['request']['messages'][number];

/** The text of a message: its string, or its text parts put end to end. */
export function messageText(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text' && typeof part['text'] === 'string')
    .map((part) => part['text'] as string)
    .join('');
}
