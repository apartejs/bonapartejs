/**
 * The journal of a conversation: the truth. Messages, tool calls and their
 * results, approvals asked and answered, and the events (compaction, a
 * branch, a rewind, a change of engine), each with what produced it.
 *
 * `rendered` is the text the entry froze into the prompt (built-in engine):
 * written once, never re-rendered. The prompt of a branch is the
 * concatenation of its entries' `rendered`, from the last rebase.
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import type { ToolDef } from '../tools/types.js';

import type { ToolResult } from '../tools/types.js';

export interface Attachment {
  name: string;
  mediaType: string;
  /** The content of a text attachment, as it enters the message. */
  text?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served by the KV cache rather than evaluated. */
  cacheReadTokens?: number;
}

export interface PendingCall {
  toolCallId: string;
  name: string;
  input: unknown;
  reason: 'approval' | 'external' | 'queued';
  agentId?: string;
}

export type Outcome =
  | { kind: 'decision'; approved: boolean; reason?: string; instruction?: string }
  | { kind: 'result'; content: string; structuredContent?: unknown }
  | { kind: 'failed'; error: string };

/** What changed since the system prompt was frozen, appended instead of rewritten (task 3.2). */
export interface Delta {
  kind: 'inventory' | 'perimeter' | 'instructions' | 'reply-language' | 'mode';
  text: string;
  /** A note of the mode: the mode it told (the next turn compares with it). */
  mode?: PlayMode;
  /** A note of the window's tools: all of them, as the model knows them after it. */
  windowTools?: ToolDef[];
  /** A note of the reply language: the language it told. */
  language?: string;
}

interface Common {
  id: string;
  /** When it was written (ISO 8601). */
  at: string;
  /** The aparté message it belongs to. */
  messageId?: string;
  /** The sub-agent that produced it. */
  agentId?: string;
  /** What it froze into the prompt (built-in engine). */
  rendered?: string;
}

export type JournalBody =
  /** `replyLanguage`: the language the frozen prompt asks the replies in (the first system turn). */
  | { kind: 'system'; replyLanguage?: string }
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  /** `truncated`: the context ran out in the middle of it — the answer is incomplete. */
  | { kind: 'assistant'; raw: string; usage?: Usage; stopped?: 'user' | 'engine'; truncated?: true }
  | { kind: 'tool-results'; results: ToolResult[] }
  | { kind: 'pending'; calls: PendingCall[]; ticket: string }
  | { kind: 'outcomes'; outcomes: Record<string, Outcome> }
  | { kind: 'delta'; delta: Delta }
  | { kind: 'rebase'; summary: string }
  | { kind: 'engine'; engineId: string; modelId: string }
  | { kind: 'rewind'; toEntryId: string; what: 'both' | 'conversation' | 'code'; fromBranchId: string }
  /** The message the server refused: it is taken back, never sent again. */
  | { kind: 'withdrawn'; entryId: string };

export type JournalEntry = Common & JournalBody;

/** What a caller writes: the journal gives the id and the time. */
export type NewJournalEntry = Omit<Common, 'id' | 'at'> & JournalBody;

export interface BranchInfo {
  branchId: string;
  /** The entry the branch was forked after; null for the first branch. */
  forkedAfter: string | null;
  /** The branch it was forked from. */
  from: string | null;
  at: string;
}

export interface Journal {
  readonly conversationId: string;
  readonly branchId: string;
  /** The entries of the branch, in order — a withdrawn message and its withdrawal left out. */
  entries(): readonly JournalEntry[];
  append(entry: NewJournalEntry): Promise<JournalEntry>;
  /** A new branch that shares this one up to `afterEntryId`, then diverges; this one is not touched. */
  fork(afterEntryId: string): Promise<Journal>;
  branches(): Promise<readonly BranchInfo[]>;
}
