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

type StreamRunner = ReturnType<typeof createAgentStreamRunner>;

export interface ConversationRunnerOptions {
  /** The mode the switch shows now: read at each turn. */
  mode?: () => PlayMode;
  /** The person picked the mode in the switch, in this run: Impro then counts as confirmed (security rule 9). */
  picked?: () => boolean;
  /** The project a new conversation starts in (the core takes it at its first turn only). */
  project?: () => string | null;
  /** Tests only. */
  fetch?: typeof globalThis.fetch;
}

export function createConversationRunner(options: ConversationRunnerOptions = {}): StreamRunner {
  const runner = createAgentStreamRunner({
    endpoint: ({ conversationId }) => {
      const at = `${AGENT_ENDPOINT}/c/${encodeURIComponent(conversationId ?? '')}`;
      const query = new URLSearchParams();
      if (options.mode) query.set('mode', options.mode());
      if (options.picked?.()) query.set('picked', '1');
      const project = options.project?.();
      if (project) query.set('project', project);
      const said = query.toString();
      return said ? `${at}?${said}` : at;
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  // A turn of no conversation has nowhere to go: refused before anything is posted.
  return (turn) =>
    turn.conversationId ? runner(turn) : Promise.reject(new Error('No conversation is open: there is nowhere to send this turn.'));
}
