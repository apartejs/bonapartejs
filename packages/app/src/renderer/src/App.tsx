import { AparteChat, useAparteClient } from '@aparte/react';
import { engineState, type EngineStateView, type Locale } from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useState } from 'react';
import { createConversationRunner } from './aparte/runner';
import { bridge } from './bridge';
import type { Messages } from './i18n/index';
import { EngineSetup } from './screens/EngineSetup';

/**
 * One conversation, drawn by aparté's chat. Its client is a pipe: aparté's
 * stock runner posts each turn to the core and replays the events that come
 * back.
 */
function Conversation({ messages }: { messages: Messages }) {
  const conversationId = useMemo(() => crypto.randomUUID(), []);
  const streamRunner = useMemo(() => createConversationRunner(conversationId), [conversationId]);
  useAparteClient({ streamRunner });

  return (
    <AparteChat
      className="bonaparte-chat"
      centerWhenEmpty
      placeholder={messages.composer.placeholder}
      emptyState={<p className="bonaparte-empty">{messages.chat.empty}</p>}
    />
  );
}

/**
 * The window, for now. With the built-in engine and no model loaded, it asks
 * which model to load; a server that already runs (a remote engine) goes
 * straight to the conversation. Launching the app never loads anything.
 */
export function App({ messages, locale }: { messages: Messages; locale: Locale }) {
  const [engine, setEngine] = useState<EngineStateView | null>(null);

  useEffect(() => {
    let current = true;
    void bridge.invoke(engineState, undefined).then((state) => {
      if (current) setEngine(state);
    });
    return () => {
      current = false;
    };
  }, []);

  const needsModel = engine?.mode === 'managed' && engine.status !== 'ready';

  return (
    <main className="bonaparte-window">
      {engine === null ? null : needsModel ? (
        <EngineSetup messages={messages} locale={locale} onReady={setEngine} />
      ) : (
        <Conversation messages={messages} />
      )}
    </main>
  );
}
