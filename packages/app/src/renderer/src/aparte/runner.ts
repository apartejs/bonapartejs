/**
 * The runner of the window: aparté's stock one, as it is, pointed at the
 * core. It runs no loop of its own; the core does. Each turn goes to the
 * conversation it belongs to — aparté hands the runner the id of the
 * conversation open when the turn was sent (apartejs/aparte#209, 1.9) — and
 * the mode the person chose, which a conversation the turn creates runs in
 * (the core never changes the mode of one that exists).
 */

import { AGENT_ENDPOINT, type PlayMode } from '@aparte/bonaparte-shared';
import { createAgentStreamRunner } from '@aparte/core';
import { activityOf, type TurnActivity } from '../logo/mascot-state';
import { endWaits, hearWait } from './engine-wait';

/** Said on the window as a turn's work changes (task 12.2): `{ conversationId, activity }`. */
export const TURN_ACTIVITY = 'bonaparte-turn-activity';

type StreamRunner = ReturnType<typeof createAgentStreamRunner>;

export interface ConversationRunnerOptions {
  /** The mode the switch shows now: read at each turn. */
  mode?: () => PlayMode;
  /** The person picked the mode in the switch, in this run: Impro then counts as confirmed (security rule 9). */
  picked?: () => boolean;
  /** The project a new conversation starts in (the core takes it at its first turn only). */
  project?: () => string | null;
  /** On its own branch: its name and its base (the core takes them at its first turn only). */
  branch?: () => { branch: string; base: string } | null;
  /** A new conversation's service and model, picked before its first message (the core takes them at its first turn only). */
  service?: () => { provider: string; model: string } | null;
  /** A new conversation without a project is a discussion (task 9.7; the core takes it at its first turn only). */
  kind?: () => 'discussion' | null;
  /** « /plugin » asked the tools that make a plugin for this conversation (audit 2026-11-21, I2): said with its turns. */
  plugins?: (conversationId: string) => boolean;
  /** What each turn is doing, said once each time it changes (task 12.2); by default, on the window (`TURN_ACTIVITY`). */
  onActivity?: (conversationId: string, activity: TurnActivity) => void;
  /** Tests only. */
  fetch?: typeof globalThis.fetch;
}

const toWindow = (conversationId: string, activity: TurnActivity): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TURN_ACTIVITY, { detail: { conversationId, activity } }));
};

export function createConversationRunner(options: ConversationRunnerOptions = {}): StreamRunner {
  const runner = createAgentStreamRunner({
    endpoint: ({ conversationId }) => {
      const at = `${AGENT_ENDPOINT}/c/${encodeURIComponent(conversationId ?? '')}`;
      const query = new URLSearchParams();
      if (options.mode) query.set('mode', options.mode());
      if (options.picked?.()) query.set('picked', '1');
      const project = options.project?.();
      if (project) query.set('project', project);
      const branch = options.branch?.();
      if (project && branch) {
        query.set('worksIn', 'branch');
        query.set('branch', branch.branch);
        query.set('base', branch.base);
      }
      if (options.kind?.() === 'discussion') query.set('kind', 'discussion');
      if (conversationId && options.plugins?.(conversationId)) query.set('plugins', '1');
      const service = options.service?.();
      if (service) {
        query.set('provider', service.provider);
        query.set('model', service.model);
      }
      const said = query.toString();
      return said ? `${at}?${said}` : at;
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  // A turn of no conversation has nowhere to go: refused before anything is posted.
  return (turn) => {
    const conversationId = turn.conversationId;
    if (!conversationId) return Promise.reject(new Error('No conversation is open: there is nowhere to send this turn.'));
    // What the turn is doing, said once each time it changes: the mascot reads it (task 12.2).
    let said: TurnActivity | null = null;
    const say = (activity: TurnActivity | null): void => {
      if (!activity || activity === said) return;
      said = activity;
      (options.onActivity ?? toWindow)(conversationId, activity);
    };
    const emitter: typeof turn.emitter = (event) => {
      const heard = event as unknown as { type: string } & Record<string, unknown>;
      say(activityOf(heard));
      // Who holds the engine, kept before aparté draws the step that names it (audit C1).
      hearWait(conversationId, heard);
      turn.emitter(event);
    };
    return runner({ ...turn, emitter })
      .catch((error: unknown) => {
        say(turn.signal.aborted ? 'stopped' : 'failed');
        throw error;
      })
      .finally(() => endWaits(conversationId));
  };
}
