/**
 * The runner of a conversation: aparté's stock one, as it is, pointed at the
 * core. It runs no loop of its own; the core does.
 */

import { AGENT_ENDPOINT } from '@aparte/bonaparte-shared';
import { createAgentStreamRunner } from '@aparte/core';

export function createConversationRunner(conversationId: string) {
  return createAgentStreamRunner({ endpoint: `${AGENT_ENDPOINT}/c/${encodeURIComponent(conversationId)}` });
}
