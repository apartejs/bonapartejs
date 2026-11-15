import { AparteChat, AparteConversationList, useAparteClient, useConversationManager } from '@aparte/react';
import {
  conversationsMemory,
  engineState,
  type ConversationMemoryView,
  type EngineStateView,
  type Locale,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useState } from 'react';
import { registerRereadProgress } from './aparte/reread-progress';
import { createConversationRunner } from './aparte/runner';
import { registerStepLabels } from './aparte/step-labels';
import { createStorageAdapter } from './aparte/storage-adapter';
import { bridge } from './bridge';
import { MemoryBanner } from './chat/MemoryBanner';
import type { Messages } from './i18n/index';
import { EngineSetup } from './screens/EngineSetup';
import { EngineCard } from './shell/EngineCard';

type Announcement = ConversationMemoryView['announcement'];

/**
 * The conversations and the one open: aparté's conversation manager, kept by
 * the core through the bridge; aparté's chat on the conversation open, each
 * turn posted by aparté's runner to the conversation it belongs to.
 * Provisional layout: the shell of the canvas comes with task 5.6.
 */
function Workspace({ messages, locale, engine }: { messages: Messages; locale: Locale; engine: EngineStateView }) {
  // The conversation open is the manager's: the chat is not driven by an id the page gives it back
  // (apartejs/aparte#212 — that reloads the conversation in the middle of its first reply).
  const { init, activeConversations, activeId: conversationId } = useConversationManager();
  const [memory, setMemory] = useState<Announcement>(null);

  const streamRunner = useMemo(() => createConversationRunner(), []);
  useAparteClient({ streamRunner });

  useEffect(() => {
    // One manager and one storage for the life of the window.
    void init(createStorageAdapter(bridge));
  }, [init]);

  useEffect(() => registerStepLabels(messages), [messages]);
  useEffect(() => registerRereadProgress(messages, locale), [messages, locale]);

  // What opening the conversation will cost, said before anything is paid.
  useEffect(() => {
    setMemory(null);
    if (!conversationId) return;
    let current = true;
    void bridge.invoke(conversationsMemory, { id: conversationId }).then((view) => {
      if (current) setMemory(view.announcement);
    });
    return () => {
      current = false;
    };
  }, [conversationId]);

  const style = { locale, units: messages.units };
  return (
    <div className="bonaparte-layout">
      <aside className="bonaparte-sidebar" aria-label={messages.conversations.list}>
        <button
          type="button"
          className="aparte-btn aparte-btn--surface bonaparte-new"
          // aparté's gesture for « a new conversation »: the chat closes the one open.
          onClick={() => window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id: null } }))}
        >
          {messages.conversations.new}
        </button>
        <AparteConversationList
          className="bonaparte-conversations"
          conversations={activeConversations}
          active-id={conversationId}
          manage
        />
        <EngineCard engine={engine} messages={messages} />
      </aside>
      <AparteChat
        className="bonaparte-chat"
        centerWhenEmpty
        placeholder={messages.composer.placeholder}
        emptyState={<p className="bonaparte-empty">{messages.chat.empty}</p>}
        // The window is one page: a link in a reply never takes it away (the main process refuses too).
        onLinkClick={(_detail, event) => event.preventDefault()}
        aboveComposer={
          memory ? <MemoryBanner announcement={memory} messages={messages} style={style} onContinue={() => setMemory(null)} /> : undefined
        }
        toolbar={engine.model ? <aparte-context window={String(engine.model.nCtx)} variant="ring" /> : undefined}
      />
    </div>
  );
}

/**
 * The window. With the built-in engine and no model loaded, it asks which
 * model to load; a server that already runs (a remote engine) goes straight
 * to the conversations. Launching the app never loads anything.
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
        <Workspace messages={messages} locale={locale} engine={engine} />
      )}
    </main>
  );
}
