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
import type { FamilyId } from '../families/types.js';
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
  /** What the engine held once this answer was written, as it counted it (llama.cpp's `tokens_cached`). */
  contextTokens?: number;
}

export interface PendingCall {
  toolCallId: string;
  name: string;
  input: unknown;
  reason: 'approval' | 'external' | 'queued';
  agentId?: string;
}

/**
 * A `run_subagent` call whose sub-agent waits for the person (task 8.1): not among the calls the page answers —
 * its sub-agent's are — but kept with the pause, so that the sub-agent's result answers it once it goes on.
 */
export interface SubagentHold {
  toolCallId: string;
  agentId: string;
  name: string;
  input: unknown;
  /**
   * Its sub-agent ended while one called before it waits for the person (in parallel): its result waits with the
   * pause, and enters the prompt after the earlier one's — the families match results to calls by position
   * (review of phase 8).
   */
  result?: { kind: 'done' | 'stopped' | 'failed'; content: string };
}

export type Outcome =
  | { kind: 'decision'; approved: boolean; reason?: string; instruction?: string }
  | { kind: 'result'; content: string; structuredContent?: unknown }
  | { kind: 'failed'; error: string };

/** What changed since the system prompt was frozen, appended instead of rewritten (task 3.2). */
export interface Delta {
  /** `note`: what the person did outside the conversation that the model must know (going back, task 7.1). */
  kind: 'inventory' | 'perimeter' | 'instructions' | 'reply-language' | 'mode' | 'note';
  text: string;
  /** A note of the mode: the mode it told (the next turn compares with it). */
  mode?: PlayMode;
  /** A note of the window's tools: all of them, as the model knows them after it. */
  windowTools?: ToolDef[];
  /** A note of the core's tools (a plugin came, or went): all of them, as the model knows them after it. */
  tools?: ToolDef[];
  /** A note of the reply language: the language it told. */
  language?: string;
  /** A note of the project's folders: the folders it told. */
  roots?: string[];
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
  /** `perimeter`: the folders the frozen prompt names (the first system turn). */
  /** `tools`: the core's tools the frozen prompt lists (the first system turn). */
  /** `modelId` (the model file's path) and `family`: what the branch's prompt was first frozen for (task 7.4). */
  | { kind: 'system'; replyLanguage?: string; perimeter?: string[]; tools?: ToolDef[]; modelId?: string; family?: FamilyId }
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  /** `truncated`: the context ran out in the middle of it — the answer is incomplete. */
  | { kind: 'assistant'; raw: string; usage?: Usage; stopped?: 'user' | 'engine'; truncated?: true }
  | { kind: 'tool-results'; results: ToolResult[] }
  | { kind: 'pending'; calls: PendingCall[]; ticket: string; subagents?: SubagentHold[] }
  | { kind: 'outcomes'; outcomes: Record<string, Outcome> }
  | { kind: 'delta'; delta: Delta }
  /**
   * A compaction (task 7.3): the prompt starts again from here. `stable`: the system turn frozen again (what a
   * seed is keyed by); the facts it froze (`replyLanguage`, `perimeter`, `tools`), as the first system turn's.
   */
  /**
   * `keptFrom`: the first entry of the turns kept as they were (none kept: absent). `keptRound`: the turn under way
   * folded on itself (review of round 2, 5) — its message kept (`keptFrom`), its rounds before this answer folded into
   * the summary, this answer and its results kept from here on. `mode` and `windowTools`: what a compaction in the
   * middle of a turn told again after its summary — the mode and the window's tools the turn was told before it.
   */
  | ({ kind: 'rebase'; summary: string; keptFrom?: string; keptRound?: string; mode?: PlayMode; windowTools?: ToolDef[] } & Refrozen)
  /**
   * A change of model (task 7.4): the prompt starts again from here, the conversation rendered again by the
   * new model's `family` (its `rendered`). `modelId`: the model file's path.
   */
  | ({ kind: 'engine'; engineId: string; modelId: string; family?: FamilyId } & Refrozen)
  /**
   * Going back before the person's message `toEntryId` (task 7.1). `note`: what the model is told at its
   * next turn (English); `undo`: the going back was undone before that turn — nothing is told.
   */
  | { kind: 'rewind'; toEntryId: string; what: 'both' | 'conversation' | 'code'; fromBranchId: string; note?: string; undo?: true }
  /** The message the server refused: it is taken back, never sent again. */
  | { kind: 'withdrawn'; entryId: string };

export type JournalEntry = Common & JournalBody;

/** The system turn frozen again (what a seed is keyed by), and the facts it froze, as the first system turn's. */
export interface Refrozen {
  stable?: string;
  replyLanguage?: string;
  perimeter?: string[];
  tools?: ToolDef[];
}

/** Where a branch's prompt starts again: a compaction, or a change of model. */
export function isRefrozen(entry: JournalEntry): entry is Extract<JournalEntry, { kind: 'rebase' | 'engine' }> {
  return entry.kind === 'rebase' || entry.kind === 'engine';
}

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
