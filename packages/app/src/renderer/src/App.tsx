import { AparteChat, useAparteClient } from '@aparte/react';
import { useMemo } from 'react';
import { createConversationRunner } from './aparte/runner';
import type { Messages } from './i18n/index';

/**
 * The window, for now: one conversation, drawn by aparté's chat. Its client
 * is a pipe: aparté's stock runner posts each turn to the core and replays
 * the events that come back.
 */
export function App({ messages }: { messages: Messages }) {
  const conversationId = useMemo(() => crypto.randomUUID(), []);
  const streamRunner = useMemo(() => createConversationRunner(conversationId), [conversationId]);
  useAparteClient({ streamRunner });

  return (
    <main className="bonaparte-window">
      <AparteChat
        className="bonaparte-chat"
        centerWhenEmpty
        placeholder={messages.composer.placeholder}
        emptyState={<p className="bonaparte-empty">{messages.chat.empty}</p>}
      />
    </main>
  );
}
