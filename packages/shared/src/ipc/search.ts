/**
 * « Rechercher » (Ctrl K, task 5.8): the conversations where the words were
 * said, with the passage around them, and the files of the open
 * conversation's project. The words are read, never run.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

export const searchResultSchema = z.object({
  conversations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      excerpt: z.object({ before: z.string(), match: z.string(), after: z.string() }),
    }),
  ),
  files: z.array(z.object({ path: z.string() })),
});
export type SearchResultView = z.infer<typeof searchResultSchema>;

export const searchQuery = defineChannel(
  'search.query',
  z.object({
    query: z.string().max(500),
    conversationId: z.string().min(1).max(128).optional(),
    // A new conversation, before its first turn: the files of the project it starts in.
    projectId: z.string().min(1).max(128).optional(),
  }),
  searchResultSchema,
);
