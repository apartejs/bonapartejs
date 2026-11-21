/**
 * Who holds the engine, as the waits say it (audit C1). A turn that waits for
 * a slot says who holds it and what it does: the core puts it on its
 * `slot-wait` step (`holder`), said again each time it changes. aparté's step
 * has a name and nothing more, and its label is a function of the locale
 * alone (apartejs/aparte#288): the runner hears the holder before aparté
 * draws the step, keeps it here, and the label of `slot-wait` reads it. With
 * one slot every wait waits for the same holder; with two, the one told last.
 *
 * The conversations that wait for the engine themselves (not one of their
 * sub-agents) are said on the window (`ENGINE_WAIT`): their row says it.
 */

import { useEffect, useState } from 'react';
import type { Messages } from '../i18n/index';

/** What the core says of the owner of a slot (`SlotHolder`). */
export interface SlotHolderView {
  conversationId: string;
  title: string;
  subagent?: string;
  doing: { kind: 'answer' } | { kind: 'tool'; tool: string; target?: string } | { kind: 'compact' };
}

/** Said on the window when a conversation starts or stops waiting for the engine: `{ conversationId, waiting }`. */
export const ENGINE_WAIT = 'bonaparte-engine-wait';

/** The waits open now that named their holder, by conversation and sub-agent; the last told last. */
const open = new Map<string, SlotHolderView>();
/** The conversations whose own turn waits for the engine. */
const waitingNow = new Set<string>();

const keyOf = (conversationId: string, agentId: string | undefined): string => `${conversationId}/${agentId ?? ''}`;

const isHolder = (value: unknown): value is SlotHolderView => {
  if (typeof value !== 'object' || value === null) return false;
  const holder = value as Record<string, unknown>;
  const doing = holder['doing'] as Record<string, unknown> | undefined;
  return typeof holder['conversationId'] === 'string' && typeof holder['title'] === 'string' && typeof doing?.['kind'] === 'string';
};

/** A run event of a conversation's turn: a wait for the slot that starts or ends is kept. */
export function hearWait(conversationId: string, event: { type: string } & Record<string, unknown>): void {
  if (event['name'] !== 'slot-wait' || (event.type !== 'step-start' && event.type !== 'step-end')) return;
  const agentId = typeof event['agentId'] === 'string' ? event['agentId'] : undefined;
  const key = keyOf(conversationId, agentId);
  open.delete(key);
  if (event.type === 'step-start' && isHolder(event['holder'])) open.set(key, event['holder']);
  if (agentId === undefined) said(conversationId, event.type === 'step-start');
}

/** The turn of a conversation ended: none of its waits is open any more. */
export function endWaits(conversationId: string): void {
  for (const key of [...open.keys()]) if (key.startsWith(`${conversationId}/`)) open.delete(key);
  said(conversationId, false);
}

function said(conversationId: string, waiting: boolean): void {
  if (waitingNow.has(conversationId) === waiting) return;
  if (waiting) waitingNow.add(conversationId);
  else waitingNow.delete(conversationId);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ENGINE_WAIT, { detail: { conversationId, waiting } }));
}

/** Does this conversation's own turn wait for the engine now? */
export function waitsForEngine(conversationId: string): boolean {
  return waitingNow.has(conversationId);
}

/** The holder the last open wait named; none: null. */
export function holderNow(): SlotHolderView | null {
  return [...open.values()].at(-1) ?? null;
}

/** The words of a wait that names its holder: « Attend le moteur : « Refonte du login » lance pnpm test ». */
export function waitLine(holder: SlotHolderView, messages: Messages): string {
  const words = messages.engineWait;
  const title = holder.title.trim() || words.untitled;
  const who = holder.subagent ? words.subagent(holder.subagent, title) : words.conversation(title);
  const doing =
    holder.doing.kind === 'tool' ? words.tool(holder.doing.tool, holder.doing.target) : holder.doing.kind === 'compact' ? words.compact : words.answer;
  return words.line(who, doing);
}

/** The conversations whose own turn waits for the engine, as they change: the rows that say it. */
export function useEngineWaits(): ReadonlySet<string> {
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(() => new Set(waitingNow));
  useEffect(() => {
    const heard = (): void => setWaiting(new Set(waitingNow));
    window.addEventListener(ENGINE_WAIT, heard);
    heard();
    return () => window.removeEventListener(ENGINE_WAIT, heard);
  }, []);
  return waiting;
}

/** Tests only. */
export function forgetWaits(): void {
  open.clear();
  waitingNow.clear();
}
