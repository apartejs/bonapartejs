/**
 * What the end of a turn tells the person when they do not look at its conversation (task 8.5, board « Notifications
 * et zone de notification »; audit C3, another conversation shown): one of four events — a reply done, an approval waiting, a question, a failure —
 * becomes a banner, only a badge, or nothing, by the person's setting for that event (Settings, Général), the
 * window's focus and « Ne pas déranger ». A banner says « <what happened> · <the conversation> », then a line.
 *
 * Never an approval given from a notification: clicking one opens its conversation, where the change is seen.
 */

import type { TurnEnd } from '@aparte/bonaparte-core';
import type { MainWords } from './i18n/index.js';

export type NotifyEvent = 'replyDone' | 'approval' | 'question' | 'failure';
export type NotifySetting = 'banner' | 'badge' | 'off';
export type Delivery = 'banner' | 'badge' | 'none';

/** The setting each end of a turn answers to (`notifications.<event>`). */
export const EVENT_OF: Record<TurnEnd['how'], NotifyEvent> = { done: 'replyDone', approval: 'approval', question: 'question', failed: 'failure' };

/**
 * A banner only when the person asked for one, they do not look at its conversation — the window not in front of
 * them, or another conversation shown in it (audit C3) — and « Ne pas déranger » is off; otherwise only the badge —
 * the item waits in « À traiter » — unless the person turned the event off.
 */
export function decide(input: { setting: NotifySetting; focused: boolean; shown: boolean; quietUntil: number | null; now: number }): Delivery {
  if (input.setting === 'off') return 'none';
  if (input.setting === 'badge') return 'badge';
  const quiet = input.quietUntil !== null && input.now < input.quietUntil;
  return (input.focused && input.shown) || quiet ? 'badge' : 'banner';
}

/** At most this long, a line of a banner: Windows cuts the rest anyway. */
const SHORT = 80;
const short = (text: string): string => (text.length > SHORT ? `${text.slice(0, SHORT - 1)}…` : text);
const field = (input: unknown, key: string): string => {
  const value = (input as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : '';
};

/** What a call waiting for an approval would do, in a few words. */
export function describeCall(call: { name: string; input: unknown }, words: MainWords['notify']): string {
  switch (call.name) {
    case 'edit_file':
      return short(words.calls.edit(field(call.input, 'path')));
    case 'write_file':
      return short(words.calls.write(field(call.input, 'path')));
    case 'run_command': {
      const args = (call.input as Record<string, unknown> | null | undefined)?.['args'];
      const command = [field(call.input, 'program'), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
      return short(words.calls.run(command));
    }
    case 'web_fetch':
      return short(words.calls.fetch(field(call.input, 'url')));
    default:
      return short(words.calls.other(call.name));
  }
}

/** A banner: « <what happened> · <the conversation> », then what the person needs to decide whether to come. */
export function notificationOf(end: TurnEnd, words: MainWords['notify']): { title: string; body: string } {
  const title = (what: string): string => `${what} · ${short(end.title.trim() || words.untitled)}`;
  switch (end.how) {
    case 'done':
      return { title: title(words.done), body: end.said.trim() || words.doneBody };
    case 'approval':
      return { title: title(words.approval), body: `${end.agent ? `${words.subagent(end.agent)} · ` : ''}${describeCall(end.call, words)}` };
    case 'question':
      return { title: title(words.question), body: end.question.trim() || words.questionBody };
    case 'failed':
      return { title: title(words.failed), body: words.failedBody };
  }
}
