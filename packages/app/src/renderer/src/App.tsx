import { AparteChat, AparteContext, useAparteClient, useConversationManager } from '@aparte/react';
import {
  conversationsMemory,
  engineState,
  modesGet,
  modesSet,
  projectsList,
  settingsGet,
  type ConversationMemoryView,
  type EngineStateView,
  type Locale,
  type PlayMode,
  type ProjectView,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { allowAndSwitch, createApprovalResolver, createApprovalsStore, followLoadedConversation } from './aparte/approvals';
import { focusComposer, prefill, sendWhenFree } from './aparte/composer';
import { setupPlanCards } from './aparte/plan-card';
import { registerRereadProgress } from './aparte/reread-progress';
import { createConversationRunner } from './aparte/runner';
import { registerStepLabels } from './aparte/step-labels';
import { registerToolLines } from './aparte/tool-lines';
import { speakAsBonaparte } from './aparte/words';
import { createStorageAdapter } from './aparte/storage-adapter';
import { bridge } from './bridge';
import { ApprovalCard } from './chat/ApprovalCard';
import { MemoryBanner } from './chat/MemoryBanner';
import { ModeSwitch } from './chat/ModeSwitch';
import { NewProject } from './dialogs/NewProject';
import { SearchPalette } from './dialogs/SearchPalette';
import type { Messages } from './i18n/index';
import { EngineSetup } from './screens/EngineSetup';
import { Rail } from './shell/Rail';
import { Sidebar } from './shell/Sidebar';
import { useConversationStatuses, useMemoryMarks, useWaitingMarks } from './shell/statuses';

type Announcement = ConversationMemoryView['announcement'];

/**
 * The conversations and the one open: aparté's conversation manager, kept by
 * the core through the bridge; aparté's chat on the conversation open, each
 * turn posted by aparté's runner to the conversation it belongs to.
 * Provisional layout: the shell of the canvas comes with task 5.6.
 */
/** Under 1 100 px, the sidebar folds into icons (board « Fenêtre étroite »). */
const NARROW = '(max-width: 1099px)';

function Workspace({ messages, locale, engine }: { messages: Messages; locale: Locale; engine: EngineStateView }) {
  // The conversation open is the manager's: the chat is not driven by an id the page gives it back
  // (apartejs/aparte#212 — that reloads the conversation in the middle of its first reply).
  const { init, activeConversations, activeId: conversationId } = useConversationManager();
  const [memory, setMemory] = useState<Announcement>(null);

  // The mode the switch shows, read at each turn: a conversation the turn creates runs in it.
  const chosen = useRef<PlayMode>('repetition');
  // The project new conversations start in (task 5.3; the sidebar's projects come with 5.6).
  const [activeProject, setActiveProject] = useState<ProjectView | null>(null);
  const project = useRef<ProjectView | null>(null);
  useEffect(() => {
    project.current = activeProject;
  }, [activeProject]);
  const [creatingProject, setCreatingProject] = useState(false);
  // « Rechercher » (Ctrl K): opened from anywhere in the window.
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The sidebar folded into icons: by the person (Ctrl B), or by a narrow window (under 1 100 px).
  const [foldedByPerson, setFoldedByPerson] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [openedWhileNarrow, setOpenedWhileNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const follow = (): void => {
      setNarrow(query.matches);
      setOpenedWhileNarrow(false);
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  const folded = narrow ? !openedWhileNarrow : foldedByPerson;
  const toggleSidebar = (): void => {
    if (narrow) setOpenedWhileNarrow((was) => !was);
    else setFoldedByPerson((was) => !was);
  };
  const toggleRef = useRef(toggleSidebar);
  toggleRef.current = toggleSidebar;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The projects, and how the sidebar groups the conversations (the setting « sidebarGrouping »).
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const readProjects = (): void => {
    bridge
      .invoke(projectsList, undefined)
      .then(setProjects)
      .catch(() => undefined);
  };
  useEffect(readProjects, []);
  const [grouping, setGrouping] = useState<'project' | 'single'>('project');
  useEffect(() => {
    bridge
      .invoke(settingsGet, { key: 'sidebarGrouping' })
      .then((value) => setGrouping(value === 'single' ? 'single' : 'project'))
      .catch(() => undefined);
  }, []);
  // Where each conversation born here was started: until its first turn tells the core.
  const bornIn = useRef(new Map<string, string | null>());

  const streamRunner = useMemo(
    () => createConversationRunner({ mode: () => chosen.current, project: () => project.current?.id ?? null }),
    [],
  );
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
  // aparté's gesture for « a new conversation »: the chat closes the one open.
  const newConversation = (): void => {
    window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id: null } }));
  };
  const listedIds = useMemo(() => activeConversations.map((conversation) => conversation.id), [activeConversations]);
  const statuses = useConversationStatuses(listedIds, asked);
  useMemoryMarks(statuses, messages.shell.memory);
  useWaitingMarks(statuses);
  const projectOf = (id: string): string | null => statuses[id]?.projectId ?? bornIn.current.get(id) ?? null;
  // A new conversation starts in the project of the conversation open.
  useEffect(() => {
    if (!conversationId) return;
    const id = statuses[conversationId]?.projectId ?? bornIn.current.get(conversationId) ?? null;
    const found = projects.find((candidate) => candidate.id === id) ?? null;
    project.current = found;
    setActiveProject(found);
  }, [conversationId, statuses, projects]);

  // The mode the conversation runs in: read again when a request comes, which it explains.
  const [mode, setMode] = useState<PlayMode>('repetition');
  // The conversations born in this window: the page saves one before its first turn reaches the
  // core, so a read then would answer the default mode; the switch's choice goes with that turn.
  // Only until it is left: coming back, its mode is the core's.
  const bornHere = useRef(new Set<string>());
  useEffect(() => {
    if (!conversationId) return;
    return () => {
      bornHere.current.delete(conversationId);
    };
  }, [conversationId]);
  useEffect(() => {
    chosen.current = mode;
  }, [mode]);
  useEffect(() => {
    // A new conversation starts in its project's default mode, else where the product does.
    if (!conversationId) {
      setMode(project.current?.defaultMode ?? 'repetition');
      return;
    }
    let current = true;
    void bridge
      .invoke(modesGet, { id: conversationId })
      .then((view) => {
        if (current && !bornHere.current.has(conversationId)) setMode(view.mode);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [conversationId, asked]);

  const [listed, setListed] = useState(false);
  useEffect(() => {
    // One manager and one storage for the life of the window.
    void init(createStorageAdapter(bridge)).then(() => setListed(true));
  }, [init]);
  // Once the list is read: the last conversation again, unless the person said otherwise (5.9).
  const reopened = useRef(false);
  useEffect(() => {
    if (!listed || reopened.current) return;
    reopened.current = true;
    const last = activeConversations[0];
    if (!last || conversationId) return;
    bridge
      .invoke(settingsGet, { key: 'reopenLast' })
      .then((reopen) => {
        // Not over a conversation the person opened, or started, meanwhile.
        if (reopen === true && open.current === null) {
          window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id: last.id } }));
        }
      })
      .catch(() => undefined);
  }, [listed, activeConversations, conversationId]);

  useEffect(() => registerStepLabels(messages), [messages]);
  useEffect(() => registerToolLines(messages), [messages]);
  useEffect(() => speakAsBonaparte(messages), [messages]);

  // The plan card of Lecture: launching it moves the conversation to Plume or Répétition — the core
  // first, so the go-ahead is decided in the new mode — then gives the model the go-ahead.
  const plans = useRef<{ refresh(): void } | null>(null);
  useEffect(() => {
    const cards = setupPlanCards(messages, {
      mode: () => chosen.current,
      launch: (next) => {
        setMode(next);
        chosen.current = next;
        const id = open.current;
        // The go-ahead leaves when the composer is free (a reply still written, a question open),
        // and only into the conversation of the plan.
        void (id ? bridge.invoke(modesSet, { id, mode: next }) : Promise.resolve())
          .catch(() => undefined)
          .then(() => sendWhenFree(messages.plan.goAhead, () => open.current === id));
      },
      adjust: () => focusComposer(),
    });
    plans.current = cards;
    return () => {
      cards.stop();
      plans.current = null;
    };
  }, [messages]);
  useEffect(() => plans.current?.refresh(), [mode]);
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
    <div className="aparte-app-shell bonaparte-shell">
      {folded ? (
        <Rail
          messages={messages}
          engine={engine}
          conversations={activeConversations}
          activeId={conversationId ?? null}
          statuses={statuses}
          onExpand={toggleSidebar}
          onNewConversation={newConversation}
          onSearch={() => setSearching(true)}
          onOpen={(id) => window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id } }))}
        />
      ) : (
        <Sidebar
          messages={messages}
          engine={engine}
          conversations={activeConversations}
          activeId={conversationId ?? null}
          projects={projects}
          projectOf={projectOf}
          grouping={grouping}
          onCollapse={toggleSidebar}
          onNewConversation={newConversation}
          onSearch={() => setSearching(true)}
          onNewProject={() => setCreatingProject(true)}
        />
      )}
      <SearchPalette
        open={searching}
        messages={messages}
        conversationId={conversationId ?? null}
        onClose={() => setSearching(false)}
        onOpenConversation={(id) => {
          setSearching(false);
          window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id } }));
        }}
        onNewConversation={(text) => {
          setSearching(false);
          window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id: null } }));
          // After the chat has cleared for the new conversation.
          setTimeout(() => prefill(text), 0);
        }}
        onInsert={(text) => {
          setSearching(false);
          prefill(text);
        }}
      />
      <NewProject
        open={creatingProject}
        messages={messages}
        onClose={() => setCreatingProject(false)}
        onCreated={(made) => {
          setCreatingProject(false);
          readProjects();
          project.current = made;
          setActiveProject(made);
          // A fresh conversation, in the project and its mode.
          chosen.current = made.defaultMode;
          setMode(made.defaultMode);
          window.dispatchEvent(new CustomEvent('aparte-conversation-select', { detail: { id: null } }));
        }}
      />
      <div className="aparte-app-shell__main bonaparte-main">
      <AparteChat
        onConversationCreated={(id) => {
          bornHere.current.add(id);
          bornIn.current.set(id, project.current?.id ?? null);
        }}
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
                setMode('plume');
                const id = request.conversationId;
                void allowAndSwitch({
                  setMode: () => (id ? bridge.invoke(modesSet, { id, mode: 'plume' }) : Promise.resolve()),
                  allow: () => approvals.answer(request.id, { approved: true }),
                });
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
