/**
 * « À traiter » (task 8.4, board « À traiter »): everything that waits for a
 * decision of the person, across the conversations — so that they decide
 * from one page, without opening each conversation:
 *
 * - an approval the core asked for (its call, as the card shows it);
 * - a sub-agent's request, named after the sub-agent;
 * - a question the model asked (`ask_user`);
 * - a pull request whose CI fails (GitHub's CLI, task 6.8);
 * - a cost to accept: a turn the engine cut — going on reads the conversation
 *   again, and what that costs is said;
 *
 * and, apart, the replies finished since the window last showed their
 * conversation (« Fini, pas encore lu »). An archived conversation waits for
 * nothing.
 */

import { familyLayer, type FamilyId } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import { branchModel } from './switch.js';
import type { JournalEntry, PendingCall } from '../journal/types.js';
import type { ConversationEngine } from './engine.js';
import type { ConversationMeta, ConversationStore } from './store.js';

export interface InboxItem {
  conversationId: string;
  title: string;
  /** When it began to wait (ISO 8601). */
  at: string;
}

export interface InboxCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Inbox {
  approvals: (InboxItem & { call: InboxCall })[];
  subagentRequests: (InboxItem & { call: InboxCall; agent: string })[];
  questions: (InboxItem & { call: InboxCall; question: string })[];
  ciFailures: (InboxItem & { pr: { number: number; url: string } })[];
  costs: (InboxItem & { tokens: number; seconds: number })[];
  unread: (InboxItem & { said: string })[];
}

export interface InboxDeps {
  store: ConversationStore;
  conversations: Pick<ConversationEngine, 'paused' | 'open' | 'status'>;
  /** The pull request of a conversation on its own branch, as GitHub's CLI says it; none without one. */
  prOf?(id: string): Promise<{ number: number; url: string; ci: 'success' | 'failure' | 'pending' | null } | null>;
}

const callOf = (call: PendingCall): InboxCall => ({ id: call.toolCallId, name: call.name, input: call.input });
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The first words of an answer, its calls and its reasoning left out: what the row of an unread reply and a
 * notification say. Read by its family's own demux when the conversation's family is known (Qwen thinks between
 * `<think>` tags, Gemma in a channel); else the tags of both are taken out.
 */
export function saidIn(raw: string, family?: FamilyId): string {
  let plain: string | null = null;
  if (family) {
    try {
      const demux = familyLayer(family).createDemux();
      plain = [...demux.push(raw), ...demux.flush()]
        .map((piece) => (piece.type === 'text' ? piece.delta : ''))
        .join('')
        .trim();
    } catch {
      plain = null;
    }
  }
  plain ??= raw
    .replace(/<\|channel>[\s\S]*?<channel\|>/g, '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/<\|tool_call>[\s\S]*?<tool_call\|>/g, '')
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 119)}…` : plain;
}

/**
 * A reply finished since the window last showed its conversation: its last answer, ended by itself (not
 * stopped), after `seenAt`, and nothing waits after it. A conversation older than the record is never unread.
 */
export function unreadAnswer(
  entries: readonly JournalEntry[],
  meta: Pick<ConversationMeta, 'seenAt'>,
): Extract<JournalEntry, { kind: 'assistant' }> | null {
  if (meta.seenAt === undefined) return null;
  const last = entries.at(-1);
  if (last?.kind === 'pending') return null;
  const answer = entries.findLast((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
  return answer && answer.stopped === undefined && answer.at > meta.seenAt ? answer : null;
}

export async function readInbox(deps: InboxDeps): Promise<Inbox> {
  const inbox: Inbox = { approvals: [], subagentRequests: [], questions: [], ciFailures: [], costs: [], unread: [] };
  const metas = (await deps.store.list()).filter((meta) => !meta.archivedAt);
  await Promise.all(metas.map((meta) => gather(deps, meta, inbox)));
  // The newest first, in each kind.
  for (const list of Object.values(inbox) as InboxItem[][]) list.sort((a, b) => b.at.localeCompare(a.at));
  return inbox;
}

async function gather(deps: InboxDeps, meta: ConversationMeta, inbox: Inbox): Promise<void> {
  const item = (at: string): InboxItem => ({ conversationId: meta.id, title: meta.title, at });
  const entries = (await openJournal(deps.store.dir, meta.id, meta.branchId)).entries();
  const last = entries.at(-1);

  if (last?.kind === 'pending') {
    for (const call of last.calls) {
      if (call.reason === 'queued') continue;
      if (call.agentId) {
        const hold = last.subagents?.find((one) => one.agentId === call.agentId);
        const agent = textOf((hold?.input as Record<string, unknown> | undefined)?.['name']) || textOf(hold?.name);
        inbox.subagentRequests.push({ ...item(last.at), call: callOf(call), agent });
      } else if (call.reason === 'external') {
        inbox.questions.push({ ...item(last.at), call: callOf(call), question: textOf((call.input as Record<string, unknown> | undefined)?.['question']) });
      } else {
        inbox.approvals.push({ ...item(last.at), call: callOf(call) });
      }
    }
  }

  const answer = entries.findLast((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
  // A turn the engine cut: going on reads the conversation again — said with what it costs. Not one frozen for
  // another model: going on changes model, which its next message asks and says (task 7.4; review of phase 8).
  if (answer && answer === last && answer.stopped === 'engine' && (await deps.conversations.status(meta.id))?.memory !== 'engine') {
    const announcement = await deps.conversations.open(meta.id).catch(() => null);
    if (announcement?.kind === 'reread' && announcement.reason !== 'other-model') {
      inbox.costs.push({ ...item(answer.at), tokens: announcement.tokens, seconds: announcement.seconds });
    }
  }
  // A reply finished since the window last showed the conversation.
  const unread = unreadAnswer(entries, meta);
  if (unread) inbox.unread.push({ ...item(unread.at), said: saidIn(unread.raw, branchModel(entries).family) });

  if (meta.worktree && deps.prOf) {
    const pr = await deps.prOf(meta.id).catch(() => null);
    if (pr?.ci === 'failure') inbox.ciFailures.push({ ...item(meta.updatedAt), pr: { number: pr.number, url: pr.url } });
  }
}
