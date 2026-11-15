import { AparteChat, AparteContext, AparteConversationList, useAparteClient, useConversationManager } from '@aparte/react';
import {
  conversationsMemory,
  engineState,
  modesGet,
  modesSet,
  type ConversationMemoryView,
  type EngineStateView,
  type Locale,
  type PlayMode,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createApprovalResolver, createApprovalsStore, followLoadedConversation } from './aparte/approvals';
import { registerRereadProgress } from './aparte/reread-progress';
import { createConversationRunner } from './aparte/runner';
import { registerStepLabels } from './aparte/step-labels';
import { registerToolLines } from './aparte/tool-lines';
import { createStorageAdapter } from './aparte/storage-adapter';
import { bridge } from './bridge';
import { ApprovalCard } from './chat/ApprovalCard';
import { MemoryBanner } from './chat/MemoryBanner';
import { ModeSwitch } from './chat/ModeSwitch';
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
  // The core decides every call; what it asks about waits here for the person's answer on the card.
  // The resolver owns the decision: aparté's page policy is never consulted.
  const approvals = useMemo(() => createApprovalsStore(), []);
  const open = useRef<string | null>(null);
  useEffect(() => {
    open.current = conversationId ?? null;
  }, [conversationId]);
  // A call paused before a reload is asked again as its conversation loads, before React hears of it.
  useEffect(
    () =>
      followLoadedConversation(window, (id) => {
        open.current = id;
      }),
    [],
  );
  const approvalResolver = useMemo(() => createApprovalResolver(approvals, () => open.current), [approvals]);
  useAparteClient({ streamRunner, approvalResolver });
  const [asked, setAsked] = useState(0);
  useEffect(() => approvals.subscribe(() => setAsked((count) => count + 1)), [approvals]);
  const request = approvals.list(conversationId ?? null)[0];

  // The mode the conversation runs in: read again when a request comes, which it explains.
  const [mode, setMode] = useState<PlayMode>('repetition');
  useEffect(() => {
    if (!conversationId) return;
    let current = true;
    void bridge
      .invoke(modesGet, { id: conversationId })
      .then((view) => {
        if (current) setMode(view.mode);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [conversationId, asked]);

  useEffect(() => {
    // One manager and one storage for the life of the window.
    void init(createStorageAdapter(bridge));
  }, [init]);

  useEffect(() => registerStepLabels(messages), [messages]);
  useEffect(() => registerToolLines(messages), [messages]);
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

  // Once a turn starts, the cost said is being paid: the banner has said its piece.
  useEffect(() => {
    const paid = (): void => setMemory(null);
    window.addEventListener('aparte-message-start', paid);
    return () => window.removeEventListener('aparte-message-start', paid);
  }, []);

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
          request ? (
            <ApprovalCard
              request={request}
              mode={mode}
              messages={messages}
              onAnswer={(answer) => approvals.answer(request.id, answer)}
              onAllowAndPlume={() => {
                // The writes after this one pass without asking; the commands still ask.
                if (request.conversationId) void bridge.invoke(modesSet, { id: request.conversationId, mode: 'plume' }).catch(() => undefined);
                setMode('plume');
                approvals.answer(request.id, { approved: true });
              }}
            />
          ) : memory ? (
            <MemoryBanner announcement={memory} messages={messages} style={style} onContinue={() => setMemory(null)} />
          ) : undefined
        }
        toolbar={
          <>
            <ModeSwitch
              mode={mode}
              messages={messages}
              onChange={(next) => {
                setMode(next);
                // The core keeps it: the next call of the conversation is decided in it.
                if (conversationId) void bridge.invoke(modesSet, { id: conversationId, mode: next }).catch(() => undefined);
              }}
            />
            {engine.model ? <AparteContext window={String(engine.model.nCtx)} variant="ring" /> : null}
          </>
        }
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
