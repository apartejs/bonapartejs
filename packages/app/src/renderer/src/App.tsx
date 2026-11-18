import type { AparteConversationSelectDetail } from '@aparte/core';
import { setupCommands } from '@aparte/plugin-triggers/commands';
import { useConversationManager, type AparteChatImperativeApi } from '@aparte/react';
import {
  conversationsMemory,
  engineLoad,
  engineModels,
  engineState,
  type ModelChoiceView,
  modesGet,
  modesSet,
  projectsList,
  settingsGet,
  type ConversationMemoryView,
  type EngineStateView,
  type Locale,
  type PlayMode,
  type ProjectView,
  changesList,
  type AppliedChangeView,
  pluginsInvoke,
  projectsDetect,
  conversationsOpenFolder,
  conversationsArchiveCheck,
  conversationsCommitBranch,
  conversationsOpenPr,
  conversationsShowPr,
  conversationsBranches,
  conversationsInbox,
  conversationsSeen,
  conversationsReadAgain,
  providersList,
  providersModels,
  providersSwitch,
  type InboxView,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { allowAndSwitch, createApprovalResolver, createApprovalsStore } from './aparte/approvals';
import { ENGINE_READY, focusComposer, prefill, sendWhenFree, speakingForThePerson, type Composer } from './aparte/composer';
import { setupPlanCards } from './aparte/plan-card';
import { registerRereadProgress } from './aparte/reread-progress';
import { createConversationRunner } from './aparte/runner';
import { registerStepLabels } from './aparte/step-labels';
import { registerToolLines } from './aparte/tool-lines';
import { speakAsBonaparte } from './aparte/words';
import { createStorageAdapter } from './aparte/storage-adapter';
import { bridge } from './bridge';
import { ApprovalCard } from './chat/ApprovalCard';
import { WhereItWorks, type Place } from './chat/WhereItWorks';
import { CHATS_TARGET, ChatDeck } from './chat/ChatDeck';
import { addComment, clearPending, editComment, markSent, pendingOf, reviewMessage, type ReviewComment } from './diff/comments-store';
import { appliedCards, ChangesPanel, useProposedCards } from './panels/ChangesPanel';
import { countLines, total } from './panels/changes';
import { FilesPanel } from './panels/FilesPanel';
import { createAgentOutput } from './panels/agent-output';
import { TerminalPanel } from './panels/TerminalPanel';
import { NO_TABS, openTab, withAgentTab, type TerminalTabs } from './panels/terminal-tabs';
import { PanelDock } from './panels/PanelDock';
import { PanelToggles } from './panels/PanelToggles';
import { close as closePane, opened, opensByItself, shownPanes, toggle as togglePane, type OpenPanes } from './panels/panes';
import { created, forget, mountHidden, newDeck, openIn, prune, shownConversation, type Deck, type LiveChat } from './chat/deck';
import { MemoryBanner } from './chat/MemoryBanner';
import { RewindBanner } from './chat/RewindBanner';
import { ContextBanner } from './chat/ContextBanner';
import { useCompaction } from './chat/useCompaction';
import { useModelSwitch } from './chat/useModelSwitch';
import { catalogueOf, showCatalogue, showServices, type ServiceCatalogue } from './aparte/model-catalogue';
import { ServiceSwitchDialog, type ServiceSwitchAsking } from './dialogs/ServiceSwitchDialog';
import { ModelSwitchDialog } from './dialogs/ModelSwitchDialog';
import { EngineUnloadedCard } from './chat/EngineUnloadedCard';
import { STOP_REPLIES } from './settings/LaunchSettings';
import { ConversationBranches, type ConversationBranchesHandle } from './chat/ConversationBranches';
import { useRewind } from './chat/useRewind';
import { setupMessageActions } from './aparte/message-actions';
import { ComposerToolbar } from './chat/ComposerToolbar';
import { NewProject } from './dialogs/NewProject';
import { ArchiveConversation } from './dialogs/ArchiveConversation';
import { RewindDialog } from './dialogs/RewindDialog';
import { OpenPr } from './dialogs/OpenPr';
import { SearchPalette } from './dialogs/SearchPalette';
import type { Messages } from './i18n/index';
import { EngineSetup } from './screens/EngineSetup';
import { ConversationHeader } from './shell/ConversationHeader';
import { Rail } from './shell/Rail';
import { ENGINE_CHANGED } from './settings/EngineMemory';
import { SETTING_CHANGED, SettingsView, type SettingsPageName } from './settings/SettingsView';
import { Sidebar } from './shell/Sidebar';
import { createSubagentTracker, setupSubagentLines } from './aparte/subagents';
import { SubagentsPanel } from './panels/SubagentsPanel';
import { InboxPage } from './screens/Inbox';
import { createQuestionsLive } from './aparte/questions';
import { useConversationStatuses, useWaitingMarks, type Statuses } from './shell/statuses';

type Announcement = ConversationMemoryView['announcement'];

/**
 * The conversations and the one open: aparté's conversation manager, kept by
 * the core through the bridge; a deck of aparté's chats, one per live
 * conversation (task 5.5), each turn posted by its chat's runner to the
 * conversation it belongs to. The conversation open is the shown chat's.
 */
/**
 * The mode a new conversation starts in from a default: Impro read from a setting or a project is no
 * confirmation (security rule 9) — it starts in Plume, and the person picks Impro in the switch.
 */
function startingMode(mode: PlayMode): PlayMode {
  return mode === 'impro' ? 'plume' : mode;
}

/** A mode from a setting's value, or null. */
function playModeOf(value: unknown): PlayMode | null {
  return value === 'lecture' || value === 'repetition' || value === 'plume' || value === 'impro' ? value : null;
}

/** Under 1 100 px, the sidebar folds into icons (board « Fenêtre étroite »). */
const NARROW = '(max-width: 1099px)';

function Workspace({ messages, locale, engine }: { messages: Messages; locale: Locale; engine: EngineStateView }) {
  // One manager for every chat; its single `activeId` names whichever chat moved last, so the
  // conversation open is the shown chat's (aparté's « several live chats »).
  const conversationManager = useConversationManager();
  const { init, activeConversations, updateTitle, pin, unpin, archive, delete: remove } = conversationManager;
  const [deck, setDeck] = useState<Deck>(newDeck);
  const conversationId = shownConversation(deck);
  // Each live chat's handle: what it holds, whether it works, its composer.
  const handles = useRef(new Map<string, AparteChatImperativeApi>()).current;
  const [memory, setMemory] = useState<Announcement>(null);

  // The mode the switch shows, read at each turn: a conversation the turn creates runs in it.
  const chosen = useRef<PlayMode>('repetition');
  // The person picked it in the switch, for the conversation about to start: theirs, not a default's.
  const picked = useRef(false);
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
        // Over the settings: they close, and the search opens over the conversations.
        setSettingsPage(null);
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // « À traiter » (task 8.4, Ctrl J): a page in the conversation's place; the chats stay mounted under it.
  const [inboxOpen, setInboxOpen] = useState(false);
  // The questions the chats put on screen (a hidden one too): « À traiter » answers one with choices.
  const questions = useMemo(() => createQuestionsLive(), []);
  const [inbox, setInbox] = useState<InboxView | null>(null);
  const [costLater, setCostLater] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setSettingsPage(null);
        setInboxOpen((was) => !was);
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
        setSettingsPage(null);
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
  // The mode a conversation without a project starts in (Settings, Permissions).
  const defaultMode = useRef<PlayMode>('repetition');
  useEffect(() => {
    bridge
      .invoke(settingsGet, { key: 'defaultMode' })
      .then((value) => {
        const parsed = playModeOf(value);
        if (!parsed) return;
        defaultMode.current = parsed;
        // Read after the first conversation was set up: a new one, outside a project, takes it now.
        if (open.current === null && !project.current) {
          setMode(startingMode(parsed));
          picked.current = false;
        }
      })
      .catch(() => undefined);
  }, []);
  // The sidebar follows its setting as the person changes it; so does the default mode.
  useEffect(() => {
    const follow = (event: Event): void => {
      const { key, value } = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (key === 'sidebarGrouping') setGrouping(value === 'single' ? 'single' : 'project');
      if (key === 'defaultMode') {
        defaultMode.current = playModeOf(value) ?? defaultMode.current;
        // A new conversation, nothing said yet, outside a project: it starts in the new default.
        if (open.current === null && !project.current) {
          setMode(startingMode(defaultMode.current));
          picked.current = false;
        }
      }
    };
    window.addEventListener(SETTING_CHANGED, follow);
    return () => window.removeEventListener(SETTING_CHANGED, follow);
  }, []);
  // The panes beside the conversation (task 6.2), and whether Changements opens by itself.
  const [panes, setPanes] = useState<OpenPanes>([]);
  const autoOpen = useRef(true);
  useEffect(() => {
    bridge
      .invoke(settingsGet, { key: 'autoOpenPanel' })
      .then((value) => {
        autoOpen.current = opensByItself(value);
      })
      .catch(() => undefined);
    const follow = (event: Event): void => {
      const { key, value } = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (key === 'autoOpenPanel') autoOpen.current = opensByItself(value);
    };
    window.addEventListener(SETTING_CHANGED, follow);
    return () => window.removeEventListener(SETTING_CHANGED, follow);
  }, []);
  // The terminal (task 6.6): its tabs live as long as the window; the agent's commands are gathered
  // from the start, even while the pane is closed.
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabs>(NO_TABS);
  const words = useRef(messages);
  words.current = messages;
  const agentOutput = useMemo(() => createAgentOutput(() => words.current.terminal.exitCode), []);
  useEffect(
    () =>
      bridge.on((event) => {
        if (event.kind !== 'command') return;
        agentOutput.push(event.output);
        if (event.output.kind === 'start') setTerminalTabs((was) => withAgentTab(was, words.current.terminal.agent));
      }),
    [agentOutput],
  );
  const newShellTab = (): void => {
    void bridge
      .invoke(pluginsInvoke, { pluginId: 'terminal', action: 'shells', payload: {} })
      .then((answer) => {
        const first = (answer as { shells?: { id: string }[] }).shells?.[0];
        if (first) setTerminalTabs((was) => openTab(was, first.id));
      })
      .catch(() => undefined);
  };
  // The settings, over the shell: null for the conversations.
  const [settingsPage, setSettingsPage] = useState<SettingsPageName | null>(null);
  // The settings closed, by any way (back, Ctrl K, Ctrl B): what they may have changed is read again —
  // the projects' default modes, the engine (unloaded, restarted).
  const wereOpen = useRef(false);
  useEffect(() => {
    if (settingsPage !== null) {
      wereOpen.current = true;
      return;
    }
    if (!wereOpen.current) return;
    wereOpen.current = false;
    readProjects();
    window.dispatchEvent(new CustomEvent(ENGINE_CHANGED));
  }, [settingsPage]);
  // Where a new conversation of a git project works (task 6.7): its folder, or its own branch.
  const [placeShown, setPlaceShown] = useState<Place | null>(null);
  const place = useRef<Place | null>(null);
  place.current = placeShown;
  // Where each conversation born here was started: until its first turn tells the core.
  const bornIn = useRef(new Map<string, string | null>());

  // The service a new conversation starts on (task 9.3): what the picker shows, picked before its first message.
  const chosenService = useRef<{ provider: string; model: string } | null>(null);
  const [, setServicePicked] = useState(0);
  const streamRunner = useMemo(
    () =>
      createConversationRunner({
        service: () => chosenService.current,
        mode: () => chosen.current,
        picked: () => picked.current,
        project: () => project.current?.id ?? null,
        // Its own branch, chosen before its first message (task 6.7).
        branch: () => (place.current?.worksIn === 'branch' && place.current.branch.trim() ? { branch: place.current.branch.trim(), base: place.current.base.trim() || 'HEAD' } : null),
      }),
    [],
  );
  // The core decides every call; what it asks about waits here for the person's answer on the card.
  // The resolver owns the decision: aparté's page policy is never consulted.
  const approvals = useMemo(() => createApprovalsStore(), []);
  const open = useRef<string | null>(null);
  open.current = conversationId;
  // A call paused before a reload is asked again as its conversation loads: aparté names its turn.
  const approvalResolver = useMemo(() => createApprovalResolver(approvals), [approvals]);
  const [asked, setAsked] = useState(0);
  useEffect(() => approvals.subscribe(() => setAsked((count) => count + 1)), [approvals]);
  // A question put on screen or settled: « À traiter » is read again, so that its card follows the question that
  // waits now — a next one asked by the same reply included (check of aparté 1.12).
  useEffect(() => questions.subscribe(() => setAsked((count) => count + 1)), [questions]);
  const request = approvals.list(conversationId ?? null)[0];
  // The changes that wait for the person in the conversation open: a mark on Changements, which
  // opens by itself unless the person said never.
  const changesWaiting = approvals.list(conversationId ?? null).filter((one) => one.name === 'edit_file' || one.name === 'write_file').length;
  useEffect(() => {
    if (changesWaiting > 0 && autoOpen.current) setPanes((was) => opened(was, 'changes'));
  }, [changesWaiting, conversationId]);
  // Where those changes would write, as the model named the files: « P » in the tree.
  const pendingPaths = approvals
    .list(conversationId ?? null)
    .flatMap((one) => (typeof one.input['path'] === 'string' && (one.name === 'edit_file' || one.name === 'write_file') ? [one.input['path']] : []));
  // A turn ended: what the panes show may have changed.
  const [turnsEnded, setTurnsEnded] = useState(0);
  useEffect(() => {
    const ended = (): void => setTurnsEnded((count) => count + 1);
    window.addEventListener('aparte-message-done', ended);
    return () => window.removeEventListener('aparte-message-done', ended);
  }, []);
  // A new conversation in a git project offers its own branch; the default is the setting's.
  useEffect(() => {
    if (conversationId || !activeProject?.roots[0]) {
      if (!conversationId) setPlaceShown(null);
      return;
    }
    let current = true;
    void Promise.all([
      bridge.invoke(projectsDetect, { folder: activeProject.roots[0] }),
      bridge.invoke(settingsGet, { key: 'newConversationWorksIn' }).catch(() => 'folder'),
      bridge.invoke(settingsGet, { key: 'branchPrefix' }).catch(() => 'bonaparte/'),
    ])
      .then(([facts, worksIn, prefix]) => {
        if (!current) return;
        if (!facts.git) {
          setPlaceShown(null);
          return;
        }
        const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
        setPlaceShown({
          worksIn: worksIn === 'branch' ? 'branch' : 'folder',
          branch: `${typeof prefix === 'string' ? prefix : 'bonaparte/'}conversation-${stamp}`,
          base: facts.git.branch ?? 'HEAD',
        });
      })
      .catch(() => current && setPlaceShown(null));
    return () => {
      current = false;
    };
  }, [conversationId, activeProject]);
  // The terminal pane opens on a shell: its first tab, on the machine's default shell.
  const terminalOpen = panes.includes('terminal');
  useEffect(() => {
    if (terminalOpen && !terminalTabs.tabs.some((tab) => tab.shellId !== null)) newShellTab();
    // Only when the pane opens.
  }, [terminalOpen]);
  // « Changements »: what waits for the person, then what the conversation changed (task 6.4).
  const [reverted, setReverted] = useState(0);
  const [applied, setApplied] = useState<AppliedChangeView[]>([]);
  useEffect(() => {
    if (!conversationId) {
      setApplied([]);
      return;
    }
    let current = true;
    bridge
      .invoke(changesList, { id: conversationId })
      .then((list) => current && setApplied(list))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [conversationId, turnsEnded, asked, reverted]);
  const writesWaiting = approvals
    .list(conversationId ?? null)
    .filter((one) => one.name === 'edit_file' || one.name === 'write_file');
  const proposedCards = useProposedCards(conversationId, writesWaiting);
  const changeCards = [...proposedCards, ...appliedCards(applied)];
  const changeCounts = total(changeCards.map((card) => countLines(card.before, card.after)));
  // The comments on the diff, per conversation (task 6.5): kept while the window lives.
  const [reviews, setReviews] = useState<Record<string, ReviewComment[]>>({});
  const review = conversationId ? (reviews[conversationId] ?? []) : [];
  const changeReview = (change: (review: ReviewComment[]) => ReviewComment[]): void => {
    if (!conversationId) return;
    setReviews((was) => ({ ...was, [conversationId]: change(was[conversationId] ?? []) }));
  };
  // They leave together, in one message, into the conversation's own chat once it is free.
  const sendReview = (): void => {
    const pending = pendingOf(review);
    if (!conversationId || pending.length === 0) return;
    const id = conversationId;
    sendWhenFree(reviewMessage(pending, messages), () => composerOf(id));
    changeReview(markSent);
  };
  // What the core says of each conversation, as the sidebar shows it — read by the deck too.
  const statusesNow = useRef<Statuses>({});
  // A chat lives on while it works or waits for the person: a reply written, a question, an approval.
  const worksOrWaits = (chat: LiveChat): boolean => {
    const handle = handles.get(chat.key);
    if (handle?.isStreaming() || (handle?.getComposer() as Composer | null | undefined)?.panelActive) return true;
    if (chat.conversationId === null) return false;
    return approvals.list(chat.conversationId).length > 0 || statusesNow.current[chat.conversationId]?.waiting === true;
  };
  // Opens a conversation — a new one for null —: its chat shown, mounted first if it was not living.
  const goTo = (id: string | null): void => {
    // Opening a conversation leaves « À traiter ».
    setInboxOpen(false);
    setDeck((was) => prune(openIn(was, id), worksOrWaits));
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  // A notification, or the notification area's menu, opens its conversation (task 8.5): never more than that.
  useEffect(
    () =>
      bridge.on((event) => {
        if (event.kind !== 'open') return;
        setSettingsPage(null);
        goToRef.current(event.conversationId);
      }),
    [],
  );
  const newConversation = (): void => goTo(null);
  // The list drives the deck, not a chat: the page shows the chat of the conversation picked.
  useEffect(() => {
    const picked = (event: Event): void => {
      const detail = (event as CustomEvent<AparteConversationSelectDetail>).detail;
      if (detail?.targetId === CHATS_TARGET) goToRef.current(detail.id);
    };
    window.addEventListener('aparte-conversation-select', picked);
    return () => window.removeEventListener('aparte-conversation-select', picked);
  }, []);
  // The composer of the chat that holds a conversation, shown or not.
  const composerOf = (id: string | null): Composer | null => {
    for (const handle of handles.values()) {
      if (id !== null && handle.getConversationId() === id) return handle.getComposer() as Composer | null;
    }
    return null;
  };
  // The conversation open, as aparté's manager lists it: its title, its pin.
  const openConversation = activeConversations.find((conversation) => conversation.id === conversationId) ?? null;
  // « / new », « / stop », « / retry », « / copy »: aparté's commands, a new conversation as « Nouvelle conversation » starts one.
  const startOver = useRef(newConversation);
  startOver.current = newConversation;
  useEffect(() => setupCommands({ onNew: () => startOver.current() }), []);
  const listedIds = useMemo(() => activeConversations.map((conversation) => conversation.id), [activeConversations]);
  const statuses = useConversationStatuses(listedIds, asked);
  // What waits for the person, read again when something may have changed it.
  useEffect(() => {
    void bridge
      .invoke(conversationsInbox, undefined)
      .then(setInbox)
      .catch(() => undefined);
  }, [statuses, asked, turnsEnded, inboxOpen]);
  const inboxCount = inbox
    ? inbox.approvals.length +
      inbox.subagentRequests.length +
      inbox.questions.length +
      inbox.ciFailures.length +
      inbox.costs.filter((cost) => !costLater.has(cost.conversationId)).length
    : 0;
  // The conversation shown is read: when it is shown, when a reply ends while the window is in front, and when the
  // window comes back in front (task 8.4: « Fini, pas encore lu » is what finished while the person looked away).
  useEffect(() => {
    if (!conversationId || inboxOpen) return;
    const seen = (): void => {
      if (document.hasFocus()) void bridge.invoke(conversationsSeen, { id: conversationId }).catch(() => undefined);
    };
    seen();
    window.addEventListener('focus', seen);
    return () => window.removeEventListener('focus', seen);
  }, [conversationId, turnsEnded, inboxOpen]);
  statusesNow.current = statuses;
  useWaitingMarks(statuses);
  // Archiving (task 6.8): a conversation whose branch has changes not committed asks first.
  const [archiving, setArchiving] = useState<{ id: string; title: string; uncommitted: number } | null>(null);
  const archiveNow = (id: string): void => {
    void archive(id);
    setDeck((was) => forget(was, id));
  };
  // The core says what is not committed (none without a branch): the rows' states may not know the branch yet.
  const askArchive = (id: string, title: string): void => {
    void bridge
      .invoke(conversationsArchiveCheck, { id })
      .then(({ uncommitted }) => (uncommitted > 0 ? setArchiving({ id, title, uncommitted }) : archiveNow(id)))
      .catch(() => archiveNow(id));
  };
  // A pull request merged archives its conversation by itself — once it is at rest: never under a
  // reply, a question or an approval, and never while the person has it in front of them (the reply
  // they read would vanish); it goes when they leave it (asked again at the next reading).
  const mergedArchived = useRef(new Set<string>());
  useEffect(() => {
    for (const [id, status] of Object.entries(statuses)) {
      if (status.pr?.state !== 'merged' || mergedArchived.current.has(id)) continue;
      if (id === conversationId && !inboxOpen) continue;
      const live = deck.chats.find((chat) => chat.conversationId === id);
      if (live && worksOrWaits(live)) continue;
      mergedArchived.current.add(id);
      archiveNow(id);
    }
    // Read again when a reply ends, or when the person leaves the conversation: it may rest now.
  }, [statuses, turnsEnded, conversationId, inboxOpen]);
  // « Ouvrir une PR »: said first — it goes online —, done on the person's word.
  const [openingPr, setOpeningPr] = useState<{ id: string; branch: string; base: string; failed: boolean } | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const projectOf = (id: string): string | null => statuses[id]?.projectId ?? bornIn.current.get(id) ?? null;
  // A new conversation starts in the project of the conversation open — as the projects now are.
  useEffect(() => {
    if (!conversationId) {
      const fresh = projects.find((candidate) => candidate.id === project.current?.id);
      if (fresh) project.current = fresh;
      return;
    }
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
      setMode(startingMode(project.current?.defaultMode ?? defaultMode.current));
      picked.current = false;
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
          goToRef.current(last.id);
        }
      })
      .catch(() => undefined);
  }, [listed, activeConversations, conversationId]);
  // After a restart, the conversations that wait for the person are mounted, not shown: their chat
  // asks again what was paused (resumeDeferred), and the card is there when they are opened.
  const pausedMounted = useRef(false);
  useEffect(() => {
    if (!listed || pausedMounted.current) return;
    if (listedIds.length > 0 && Object.keys(statuses).length === 0) return;
    pausedMounted.current = true;
    const waiting = Object.entries(statuses)
      .filter(([, status]) => status.waiting)
      .map(([id]) => id);
    if (waiting.length > 0) setDeck((was) => mountHidden(was, waiting));
  }, [listed, listedIds, statuses]);

  useEffect(() => registerStepLabels(messages), [messages]);
  useEffect(() => registerToolLines(messages), [messages]);
  useEffect(() => speakAsBonaparte(messages), [messages]);
  // The sub-agents (task 8.2): aparté's line for each in the reply, and what the pane says of them.
  const subagents = useMemo(() => createSubagentTracker(), []);
  useEffect(() => setupSubagentLines(subagents), [subagents]);
  const [, heardSubagents] = useState(0);
  useEffect(() => subagents.subscribe(() => heardSubagents((count) => count + 1)), [subagents]);
  // While a chat's sub-agents work, its Stop says so (aparté 1.12, apartejs/aparte#249); back to « Arrêter » after.
  useEffect(
    () =>
      subagents.subscribe(() => {
        for (const [chatId, handle] of handles) {
          const composer = handle.getComposer();
          if (!composer) continue;
          const working = subagents.rowsOf(chatId).some((row) => row.state === 'running' || row.state === 'queued');
          const label = working ? words.current.subagentsPane.stop : null;
          if (composer.stopLabel !== label) composer.stopLabel = label;
        }
      }),
    [subagents],
  );
  const [subagentOpen, setSubagentOpen] = useState<string | null>(null);
  useEffect(() => {
    // A line's « Ouvrir » (aparté's `open: 'event'`): the pane opens on that sub-agent.
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;
      if (!detail?.agentId) return;
      setSubagentOpen(detail.agentId);
      setPanes((was) => opened(was, 'subagents'));
    };
    window.addEventListener('aparte-subagent-open', onOpen);
    return () => window.removeEventListener('aparte-subagent-open', onOpen);
  }, []);

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
          // Into the chat of the plan's conversation, shown or not, once it is free.
          .then(() => sendWhenFree(messages.plan.goAhead, () => composerOf(id)));
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
  // A message's buttons: aparté's « Modifier », « Copier », « Réessayer », and « Revenir avant », « Brancher » (task 7.2).
  useEffect(() => setupMessageActions(messages.rewind), [messages]);
  // Going back before a message, and the branches of a conversation (task 7.2).
  const forks = useRef<ConversationBranchesHandle>(null);
  const shownIdRef = useRef(conversationId);
  shownIdRef.current = conversationId;
  const rewinding = useRewind({
    handles,
    replaceMessages: async (id, shown, tree) => {
      await conversationManager.manager?.updateMessages(id, shown as Parameters<NonNullable<typeof conversationManager.manager>['updateMessages']>[1], tree as Parameters<NonNullable<typeof conversationManager.manager>['updateMessages']>[2]);
    },
    unmount: (id) => setDeck((was) => forget(was, id)),
    mount: (id) => setDeck((was) => openIn(was, id)),
    openBranchesAt: (id, userIndex) => {
      if (id === shownIdRef.current) forks.current?.openAt(userIndex);
    },
    changed: () => setAsked((count) => count + 1),
  });

  // The composer's picker lists the core's models, the one that runs — else the one a load would bring
  // back — shown chosen (task 7.4).
  const runningModel = engine.model?.path ?? engine.resume?.path;
  const [modelChoices, setModelChoices] = useState<ModelChoiceView[]>([]);
  useEffect(() => {
    // A server that already runs serves its own model: no picker, so no models read from the disk, and nothing
    // told to aparté's config — whose every change draws the conversation lists again (apartejs/aparte#251).
    if (!runningModel || engine.mode === 'remote') return;
    let live = true;
    void bridge
      .invoke(engineModels, undefined)
      .then((found) => {
        if (!live) return;
        setModelChoices(found);
        showCatalogue(catalogueOf(found, messages, { locale, units: messages.units }), messages.modelSwitch.provider, runningModel);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runningModel, engine.mode, messages, locale]);

  // The services added (task 9.3): their models offered in the composer's picker, beside the engine's.
  const servicesKnown = useRef<ServiceCatalogue[]>([]);
  // Going to a service between two turns: what it loses said first, in a dialog.
  const [toService, setToService] = useState<(ServiceSwitchAsking & { conversationId: string; provider: string; revert: () => void }) | null>(null);
  const [toServiceBusy, setToServiceBusy] = useState(false);
  const [toServiceFailed, setToServiceFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await bridge.invoke(providersList, undefined);
      const found = await Promise.all(
        all
          .filter((provider) => provider.kind === 'openai-compat')
          .map(async (provider) => ({
            id: provider.id,
            label: provider.label,
            models: await bridge.invoke(providersModels, { id: provider.id }).catch(() => [] as string[]),
          })),
      );
      if (!live) return;
      servicesKnown.current = found;
      showServices(found satisfies ServiceCatalogue[]);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // The conversation shown on a service: the picker shows its model; a new conversation after it starts there too,
  // as the picker shows. One on the built-in engine brings the picker — and the next new one — back to the engine.
  const shownService = conversationId ? (statuses[conversationId]?.service ?? null) : null;
  useEffect(() => {
    if (!conversationId) return;
    const status = statuses[conversationId];
    if (!status) return;
    chosenService.current = status.service ? { provider: status.service.id, model: status.service.model } : null;
  }, [conversationId, statuses]);

  // The engine unloaded (task 7.4; board « Coûts annoncés », 5): the conversation stays, a card says what
  // loading costs. A message sent meanwhile is held: aparté's `aparte-before-send`, cancelled, keeps it in the
  // composer, text and files, with nothing added to the thread (aparté 1.12, apartejs/aparte#245) — a message
  // queued during a reply too.
  const engineDown = engine.mode === 'managed' && engine.status !== 'ready';
  // The model a load brings back: the one unloaded (or known), else the one loading now.
  const toLoad = engine.resume ?? (engine.model ? { path: engine.model.path, name: engine.model.name } : undefined);
  const downRef = useRef(engineDown);
  downRef.current = engineDown;
  const [held, setHeld] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!engineDown) {
      setHeld(false);
      setLoadFailed(false);
      // What was sent in the person's name meanwhile goes now (`sendWhenFree`).
      window.dispatchEvent(new Event(ENGINE_READY));
    }
  }, [engineDown]);
  useEffect(() => {
    const hold = (event: Event): void => {
      if (!downRef.current) return;
      event.preventDefault();
      // A message sent in the person's name waits for the engine by itself, the person's draft left in the
      // composer: the card has nothing of theirs to keep (check of aparté 1.12).
      if (!speakingForThePerson()) setHeld(true);
    };
    window.addEventListener('aparte-before-send', hold, { capture: true });
    return () => window.removeEventListener('aparte-before-send', hold, { capture: true });
  }, []);
  const loadAndSend = async (): Promise<void> => {
    const path = toLoad?.path;
    if (!path) return;
    setLoadingModel(true);
    setLoadFailed(false);
    const result = await bridge.invoke(engineLoad, { path }).catch(() => null);
    setLoadingModel(false);
    if (!result?.ok) {
      setLoadFailed(true);
      return;
    }
    // Loaded: what waits in the shown composer goes now, before the window has read the engine again.
    downRef.current = false;
    setHeld(false);
    window.dispatchEvent(new CustomEvent(ENGINE_CHANGED));
    // Not under a turn that waits for the person (an approval paused while the engine was let go): aparté's submit
    // would stop that turn; what is written stays, for when the person has answered (check of aparté 1.12).
    const composer = handles.get(deck.shown)?.getComposer();
    if (composer && !composer.streaming && composer.value.trim() !== '') composer.submit();
  };
  // « Maintenant » for a setting that restarts the engine (task 7.4): the replies that run are stopped.
  useEffect(() => {
    const stop = (): void => {
      for (const handle of handles.values()) if (handle.isStreaming()) handle.getComposer()?.cancel();
    };
    window.addEventListener(STOP_REPLIES, stop);
    return () => window.removeEventListener(STOP_REPLIES, stop);
  }, [handles]);
  // « Un autre modèle… »: the composer's picker, opened.
  const pickerOpener = useRef<(() => void) | null>(null);
  const resumeCost = modelChoices.find((choice) => choice.path === toLoad?.path)?.announcement ?? null;

  // Changing model (task 7.4): its cost said in a dialog first; a copy made is listed again, then shown.
  // The dialog said the re-reading: the next announcement of that conversation, or of its copy, is not shown.
  const saidBySwitch = useRef(new Set<string>());
  const modelSwitch = useModelSwitch({
    handles,
    conversationId,
    showCopy: async (id) => {
      saidBySwitch.current.add(id);
      await conversationManager.manager?.init();
      goToRef.current(id);
    },
    onSwitching: (id) => {
      if (id) saidBySwitch.current.add(id);
    },
    onSwitchFailed: (id) => {
      if (id) saidBySwitch.current.delete(id);
    },
    onSwitched: (id) => {
      if (id === shownIdRef.current) setMemory(null);
    },
  });

  // Compaction (task 7.3): the context nearly full said, « Compacter », « / compact », « Restaurer ».
  const compaction = useCompaction({
    handles,
    conversationId,
    turnsEnded,
    messages,
    onRestored: (id) => {
      void bridge.invoke(conversationsMemory, { id }).then((view) => {
        if (id === shownIdRef.current) setMemory(view.announcement);
      });
    },
  });

  // What opening the conversation will cost, said before anything is paid — again once the engine serves:
  // unloaded, it could say nothing (task 7.4). Not over a reply that began meanwhile: its cost is paid.
  const serving = engine.status === 'ready';
  useEffect(() => {
    setMemory(null);
    if (!conversationId || !serving) return;
    let current = true;
    void bridge.invoke(conversationsMemory, { id: conversationId }).then((view) => {
      if (!current) return;
      // Said already by the dialog of a change of model.
      if (saidBySwitch.current.delete(conversationId)) return;
      for (const handle of handles.values()) if (handle.getConversationId() === conversationId && handle.isStreaming()) return;
      setMemory(view.announcement);
    });
    return () => {
      current = false;
    };
  }, [conversationId, serving]);

  // Once a turn starts, the cost said is being paid: the banner has said its piece.
  useEffect(() => {
    const paid = (): void => setMemory(null);
    window.addEventListener('aparte-message-start', paid);
    return () => window.removeEventListener('aparte-message-start', paid);
  }, []);

  const style = { locale, units: messages.units };
  return (
    <>
    {settingsPage ? (
      <SettingsView messages={messages} locale={locale} page={settingsPage} onPage={setSettingsPage} onBack={() => setSettingsPage(null)} />
    ) : null}
    <div className="aparte-app-shell bonaparte-shell" hidden={settingsPage !== null}>
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
          onOpen={(id) => goTo(id)}
          onSettings={() => setSettingsPage('general')}
        />
      ) : (
        <Sidebar
          messages={messages}
          engine={engine}
          conversations={activeConversations}
          activeId={conversationId ?? null}
          projects={projects}
          projectOf={projectOf}
          marksOf={(id) => ({
            memory: statuses[id]?.memory ?? null,
            ...(statuses[id]?.branch ? { branchFiles: statuses[id]!.branch!.files } : {}),
            ...(statuses[id]?.pr ? { pr: statuses[id]!.pr! } : {}),
            // Unread: never the conversation the person is looking at.
            ...(statuses[id]?.unread && id !== conversationId ? { unread: true } : {}),
          })}
          grouping={grouping}
          onCollapse={toggleSidebar}
          onNewConversation={newConversation}
          onSearch={() => setSearching(true)}
          onNewProject={() => setCreatingProject(true)}
          inbox={{
            count: inboxCount,
            open: inboxOpen,
            onOpen: () => {
              setSettingsPage(null);
              setInboxOpen(true);
            },
          }}
          onSettings={() => setSettingsPage('general')}
        />
      )}
      <SearchPalette
        open={searching}
        messages={messages}
        conversationId={conversationId ?? null}
        onClose={() => setSearching(false)}
        onOpenConversation={(id) => {
          setSearching(false);
          goTo(id);
        }}
        onNewConversation={(text) => {
          setSearching(false);
          goTo(null);
          // After the chat has cleared for the new conversation.
          setTimeout(() => prefill(text), 0);
        }}
        onInsert={(text) => {
          setSearching(false);
          prefill(text);
        }}
      />
      <RewindDialog
        messages={messages}
        locale={locale}
        asking={rewinding.asking}
        busy={rewinding.busy}
        onCancel={rewinding.cancel}
        onRewind={rewinding.rewind}
      />
      <ServiceSwitchDialog
        messages={messages}
        asking={toService}
        busy={toServiceBusy}
        failed={toServiceFailed}
        onCancel={() => {
          if (toServiceBusy) return;
          toService?.revert();
          setToService(null);
        }}
        onSwitch={() => {
          if (!toService) return;
          setToServiceBusy(true);
          void bridge
            .invoke(providersSwitch, { conversationId: toService.conversationId, id: toService.provider, model: toService.model })
            .then(() => {
              setToService(null);
              setAsked((count) => count + 1);
            })
            .catch(() => setToServiceFailed(true))
            .finally(() => setToServiceBusy(false));
        }}
      />
      <ModelSwitchDialog
        messages={messages}
        style={style}
        asking={modelSwitch.asking}
        busy={modelSwitch.busy}
        refused={modelSwitch.refused}
        onCancel={modelSwitch.cancel}
        onSwitch={modelSwitch.change}
      />
      <ArchiveConversation
        messages={messages}
        asking={archiving}
        onCancel={() => setArchiving(null)}
        onArchive={() => {
          if (archiving) archiveNow(archiving.id);
          setArchiving(null);
        }}
        onCommitFirst={() => {
          const asked = archiving;
          setArchiving(null);
          if (!asked) return;
          void bridge
            .invoke(conversationsCommitBranch, { id: asked.id })
            .catch(() => false)
            .then(() => archiveNow(asked.id));
        }}
      />
      <OpenPr
        messages={messages}
        asking={openingPr}
        busy={prBusy}
        onCancel={() => setOpeningPr(null)}
        onOpen={() => {
          const asked = openingPr;
          if (!asked) return;
          setPrBusy(true);
          void bridge
            .invoke(conversationsOpenPr, { id: asked.id })
            .catch(() => null)
            .then((pr) => {
              setPrBusy(false);
              if (pr) {
                setOpeningPr(null);
                setAsked((count) => count + 1);
              } else setOpeningPr({ ...asked, failed: true });
            });
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
          // A fresh conversation, in the project and its mode — an Impro default as any default (rule 9).
          chosen.current = startingMode(made.defaultMode);
          setMode(startingMode(made.defaultMode));
          picked.current = false;
          goTo(null);
        }}
      />
      {inboxOpen ? (
        <InboxPage
          messages={messages}
          locale={locale}
          inbox={inbox}
          requests={approvals.list()}
          later={costLater}
          engineDown={engineDown}
          questionOf={(id) => questions.of(id)}
          onAnswer={(id, answer) => approvals.answer(id, answer)}
          onOpen={(id) => goTo(id)}
          onReadAgain={async (id) => {
            await bridge.invoke(conversationsReadAgain, { id }).catch(() => undefined);
            setAsked((count) => count + 1);
          }}
          onLater={(id) => setCostLater((was) => new Set([...was, id]))}
          onFix={(id, number) => {
            goTo(id);
            sendWhenFree(messages.inbox.fixMessage(number), () => composerOf(id));
          }}
          onShowPr={(id) => void bridge.invoke(conversationsShowPr, { id }).catch(() => undefined)}
        />
      ) : null}
      <ConversationHeader
        hidden={inboxOpen}
        messages={messages}
        conversationId={openConversation ? openConversation.id : null}
        title={openConversation?.title ?? ''}
        project={projects.find((candidate) => openConversation && candidate.id === projectOf(openConversation.id))?.name ?? null}
        memory={openConversation ? (statuses[openConversation.id]?.memory ?? null) : null}
        pinned={Boolean((openConversation as { pinnedAt?: number } | null)?.pinnedAt)}
        onRename={(title) => openConversation && void updateTitle(openConversation.id, title)}
        onPin={() => openConversation && void pin(openConversation.id)}
        onUnpin={() => openConversation && void unpin(openConversation.id)}
        onArchive={() => {
          if (openConversation) askArchive(openConversation.id, openConversation.title);
        }}
        onDelete={() => {
          if (!openConversation) return;
          void remove(openConversation.id);
          setDeck((was) => forget(was, openConversation.id));
        }}
        counts={
          changeCards.length > 0 && changeCounts.added + changeCounts.removed > 0
            ? { ...changeCounts, onOpen: () => setPanes((was) => opened(was, 'changes')) }
            : null
        }
        branch={
          openConversation && statuses[openConversation.id]?.branch
            ? {
                ...statuses[openConversation.id]!.branch!,
                onOpenFolder: () => void bridge.invoke(conversationsOpenFolder, { id: openConversation.id }).catch(() => undefined),
              }
            : null
        }
        pr={
          openConversation && statuses[openConversation.id]?.pr
            ? {
                ...statuses[openConversation.id]!.pr!,
                onShow: () => void bridge.invoke(conversationsShowPr, { id: openConversation.id }).catch(() => undefined),
              }
            : null
        }
        onOpenPr={() => {
          const branch = openConversation ? statuses[openConversation.id]?.branch : undefined;
          if (openConversation && branch) setOpeningPr({ id: openConversation.id, branch: branch.name, base: branch.base, failed: false });
        }}
        forks={
          openConversation ? (
            <ConversationBranches
              ref={forks}
              messages={messages}
              load={() => bridge.invoke(conversationsBranches, { id: openConversation.id })}
              onPick={(branchId) => rewinding.showBranch(openConversation.id, branchId)}
            />
          ) : null
        }
        panels={<PanelToggles messages={messages} open={panes} waiting={changesWaiting} onToggle={(pane) => setPanes((was) => togglePane(was, pane, narrow))} />}
      />
      <div className="aparte-app-shell__main bonaparte-main">
      <div className="bonaparte-conversation" hidden={inboxOpen}>
      <ChatDeck
        deck={deck}
        messages={messages}
        streamRunner={streamRunner}
        approvalResolver={approvalResolver}
        handles={handles}
        onCreated={(key, id) => {
          setDeck((was) => created(was, key, id));
          bornHere.current.add(id);
          bornIn.current.set(id, project.current?.id ?? null);
        }}
        aboveComposer={
          // The engine down comes first (review of phase 7): a send is held, an approval would resume into
          // nothing — loading it is what everything else waits for.
          engineDown && toLoad ? (
            <EngineUnloadedCard
              messages={messages}
              style={style}
              resume={engine.resume ?? toLoad}
              cost={resumeCost ? { seconds: resumeCost.seconds, vramBytes: resumeCost.vramBytes } : null}
              held={held}
              loading={loadingModel || engine.status === 'starting' || engine.status === 'restarting'}
              failed={loadFailed}
              onLoad={() => void loadAndSend()}
              onOther={() => pickerOpener.current?.()}
            />
          ) : request ? (
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
          ) : rewinding.rewound && rewinding.rewound.conversationId === conversationId ? (
            <RewindBanner rewound={rewinding.rewound} messages={messages} locale={locale} busy={rewinding.busy} onUndo={rewinding.undo} />
          ) : memory ? (
            <MemoryBanner
              announcement={memory}
              messages={messages}
              style={style}
              onContinue={() => setMemory(null)}
              onCompactFirst={() => {
                setMemory(null);
                if (conversationId) compaction.compact(conversationId);
              }}
            />
          ) : conversationId && (compaction.state || compaction.context) ? (
            <ContextBanner
              context={compaction.context}
              state={compaction.state}
              messages={messages}
              locale={locale}
              onCompact={() => compaction.compact(conversationId)}
              onLater={compaction.later}
            />
          ) : !conversationId && placeShown ? (
            <WhereItWorks messages={messages} place={placeShown} onChange={setPlaceShown} />
          ) : undefined
        }
        toolbar={
          <ComposerToolbar
            messages={messages}
            mode={mode}
            onMode={(next) => {
              setMode(next);
              if (!conversationId) picked.current = true;
              // The core keeps it: the next call of the conversation is decided in it.
              if (conversationId) void bridge.invoke(modesSet, { id: conversationId, mode: next }).catch(() => undefined);
            }}
            engine={engine}
            scope={() =>
              conversationId ? { conversationId } : project.current ? { projectId: project.current.id } : {}
            }
            onPickModel={modelSwitch.ask}
            opener={pickerOpener}
            service={shownService ? { id: shownService.id, model: shownService.model } : chosenService.current ? { id: chosenService.current.provider, model: chosenService.current.model } : null}
            onPickService={(provider, model, revert) => {
              const shown = handles.get(deck.shown);
              const begun = (shown?.getMessages().length ?? 0) > 0;
              // Before its first message, the conversation starts where the person picked (task 9.3).
              if (!begun) {
                chosenService.current = provider ? { provider, model } : null;
                setServicePicked((count) => count + 1);
                return;
              }
              // Once it has begun, it changes provider between two turns, what it costs said first.
              if (!conversationId) return revert();
              if (provider) {
                const label = servicesKnown.current.find((known) => known.id === provider)?.label ?? provider;
                setToServiceFailed(false);
                setToService({ conversationId, provider, model, service: label, keptFor: shownService ? null : (engine.model?.name ?? null), revert });
                return;
              }
              // Back to the built-in engine's model: its re-reading said, as for any change of model.
              if (shownService && engine.model) modelSwitch.ask(engine.model.path, engine.model.name, revert);
              else revert();
            }}
          />
        }
      />
      </div>
      <PanelDock
        messages={messages}
        hidden={inboxOpen}
        shown={shownPanes(panes, narrow)}
        narrow={narrow}
        content={{
          subagents: {
            body: (
              <SubagentsPanel
                messages={messages}
                chatId={deck.shown || null}
                rows={subagents.rowsOf(deck.shown, () => handles.get(deck.shown)?.getMessages() ?? [])}
                selected={subagentOpen}
                onSelect={setSubagentOpen}
              />
            ),
          },
          terminal: {
            body: (
              <TerminalPanel
                messages={messages}
                tabs={terminalTabs}
                onTabs={setTerminalTabs}
                onNewTab={newShellTab}
                cwd={activeProject?.roots[0] ?? null}
                agent={agentOutput}
              />
            ),
          },
          changes: {
            meta: (
              <>
                {`${messages.changes.files(changeCards.length)} · `}
                <span className="changes-pane__added">{messages.changes.added(changeCounts.added)}</span>{' '}
                <span className="changes-pane__removed">{messages.changes.removed(changeCounts.removed)}</span>
              </>
            ),
            body: (
              <ChangesPanel
                messages={messages}
                conversationId={conversationId}
                cards={changeCards}
                onReverted={() => setReverted((count) => count + 1)}
                review={review}
                onComment={(detail) => changeReview((was) => addComment(was, detail, crypto.randomUUID()))}
                onEdit={(id, text) => changeReview((was) => editComment(was, id, text))}
                onClear={() => changeReview(clearPending)}
                onSend={sendReview}
              />
            ),
          },
          files: {
            meta: activeProject?.name ?? messages.files.home,
            body: (
              <FilesPanel
                messages={messages}
                scope={conversationId ? { conversationId } : activeProject ? { projectId: activeProject.id } : {}}
                conversationId={conversationId}
                pending={pendingPaths}
                refresh={turnsEnded + asked}
              />
            ),
          },
        }}
        onClose={(pane) => setPanes((was) => closePane(was, pane))}
      />
      </div>
    </div>
    </>
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

  // « Décharger » or « Redémarrer » in the settings: the state read again — no model, « Démarrer » again.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Read, and read again while the engine starts (a restart under way): the conversations come back once it is ready.
    const follow = (): void => {
      clearTimeout(timer);
      void bridge.invoke(engineState, undefined).then((state) => {
        setEngine(state);
        if (state.status === 'starting') timer = setTimeout(follow, 500);
      });
    };
    window.addEventListener(ENGINE_CHANGED, follow);
    // The engine changed on its own (unloaded for want of work, gone): the core says it.
    const off = bridge.on((event) => {
      if (event.kind === 'engine') follow();
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener(ENGINE_CHANGED, follow);
      off();
    };
  }, []);

  // « Préparons le moteur » until a model is known; then the conversations stay, and a card offers to load
  // it again (task 7.4). Once shown, they stay: a load or a restart under way never takes them down.
  const shown = useRef(false);
  const needsModel = !shown.current && engine?.mode === 'managed' && engine.status !== 'ready' && engine.resume === undefined;
  if (engine !== null && !needsModel) shown.current = true;

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
