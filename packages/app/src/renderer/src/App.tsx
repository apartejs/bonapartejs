import { aparteGlobalConfig } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locale-fr';
import type {
  ApprovalRequestDto,
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ConversationOpenResultDto,
  ConversationSummaryDto,
  PluginStatusDto,
  PlayModeDto,
  ProjectSummaryDto,
  SidebarGroupingDto,
  SidebarSortDto,
} from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bootstrapHighlighting } from './aparte-bootstrap.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { ChatScreen } from './components/ChatScreen.js';
import { ConversationHeader } from './components/ConversationHeader.js';
import { ConversationSidebar } from './components/ConversationSidebar.js';
import { ProjectDialog } from './components/ProjectDialog.js';
import { SettingsHub } from './components/SettingsHub.js';
import { ToolingPanel } from './components/ToolingPanel.js';
import { ModelPicker } from './components/ModelPicker.js';
import { SetupPanel } from './components/SetupPanel.js';
import { StatusStrip } from './components/StatusStrip.js';
import { useTranslate } from './i18n/LocaleProvider.js';
import { ResizeHandle } from './layout/ResizeHandle.js';
import { PANEL_BOUNDS, SIDEBAR_BOUNDS, useLayout } from './layout/use-layout.js';
import { useToolingTabs } from './tooling/use-tooling-tabs.js';

type View = 'boot' | 'setup' | 'pickModel' | 'chat';

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-aparte-theme') === 'dark'
    ? 'dark'
    : 'light';
}

export function App() {
  const { locale, t } = useTranslate();
  const layout = useLayout();
  const [view, setView] = useState<View>('boot');
  const [backendStatus, setBackendStatus] = useState<BackendStatusDto>('stopped');
  const [opened, setOpened] = useState<ConversationOpenResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<CompletionStatsDto | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [config, setConfig] = useState<BackendConfigDto | undefined>(undefined);
  const pendingConv = useRef<string | undefined>(undefined);
  const bootAttempted = useRef(false);
  const [mode, setModeState] = useState<PlayModeDto>('repetition');
  const [approval, setApproval] = useState<ApprovalRequestDto | null>(null);
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [plugins, setPlugins] = useState<PluginStatusDto[]>([]);
  /**
   * Tooling tabs for the open conversation. The state lives here because it
   * is READ in two places: the tab strip, in the header, and their content,
   * in the panel.
   */
  const tooling = useToolingTabs({
    conversationId: opened?.conversationId ?? null,
    plugins,
    onOpen: layout.expandPanel,
  });
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  /** null = closed; { project: null } = creation. */
  const [projectDialog, setProjectDialog] = useState<{
    project: ProjectSummaryDto | null;
  } | null>(null);
  // Menu organization: pure display preference, hence local — lifting it up
  // to the main process would restart the app for a cosmetic setting.
  const [grouping, setGrouping] = useState<SidebarGroupingDto>(
    () => (localStorage.getItem('bp.sidebar.grouping') as SidebarGroupingDto) || 'project',
  );
  const [sort, setSort] = useState<SidebarSortDto>(
    () => (localStorage.getItem('bp.sidebar.sort') as SidebarSortDto) || 'updated',
  );

  /** The menu is reread after every event that can change it. */
  const refreshConversations = useCallback(async () => {
    setConversations(await window.bonaparte.listConversations());
    setProjects(await window.bonaparte.listProjects());
  }, []);

  const changeGrouping = useCallback((next: SidebarGroupingDto) => {
    setGrouping(next);
    try {
      localStorage.setItem('bp.sidebar.grouping', next);
    } catch {
      /* non-blocking */
    }
  }, []);

  const changeSort = useCallback((next: SidebarSortDto) => {
    setSort(next);
    try {
      localStorage.setItem('bp.sidebar.sort', next);
    } catch {
      /* non-blocking */
    }
  }, []);

  /**
   * Saves a project — creation or editing — then refreshes everything: the
   * scope may have changed, hence the menu AND the header.
   */
  const saveProject = useCallback(
    async (name: string, roots: string[]) => {
      const editing = projectDialog?.project ?? null;
      if (editing) {
        await window.bonaparte.renameProject(editing.id, name);
        await window.bonaparte.setProjectRoots(editing.id, roots);
      } else {
        const created = await window.bonaparte.createProject(name, roots);
        // A project created from a conversation without a project adopts it:
        // otherwise the user would create a project that's useless right now.
        const current = opened?.conversationId;
        if (current) {
          await window.bonaparte.setConversationProject(current, created.id);
        }
      }
      setProjectDialog(null);
      await refreshConversations();
    },
    [projectDialog, opened, refreshConversations],
  );

  const deleteProject = useCallback(async () => {
    const editing = projectDialog?.project;
    if (!editing) return;
    await window.bonaparte.removeProject(editing.id);
    setProjectDialog(null);
    await refreshConversations();
  }, [projectDialog, refreshConversations]);

  const moveConversation = useCallback(
    async (projectId: string | null) => {
      const current = opened?.conversationId;
      if (!current) return;
      await window.bonaparte.setConversationProject(current, projectId);
      await refreshConversations();
    },
    [opened, refreshConversations],
  );

  const renameCurrent = useCallback(
    async (title: string) => {
      const current = opened?.conversationId;
      if (!current) return;
      await window.bonaparte.renameConversation(current, title);
      await refreshConversations();
    },
    [opened, refreshConversations],
  );

  /** Project of the open conversation, drawn from the already-loaded index. */
  const currentProjectSummary =
    projects.find(
      (p) =>
        p.id ===
        conversations.find((c) => c.id === opened?.conversationId)?.projectId,
    ) ?? null;

  useEffect(() => window.bonaparte.onApprovalRequest(setApproval), []);

  useEffect(() => {
    void window.bonaparte.getMode().then(setModeState);
  }, []);

  const changeMode = useCallback((next: PlayModeDto) => {
    setModeState(next);
    void window.bonaparte.setMode(next);
  }, []);

  const respondToApproval = useCallback(
    (granted: boolean, always?: boolean) => {
      if (!approval) return;
      void window.bonaparte.respondToApproval({
        id: approval.id,
        granted,
        ...(always ? { always } : {}),
      });
      setApproval(null);
    },
    [approval],
  );

  // Locale of aparté components (internal strings of the web components).
  useEffect(() => {
    // 0.13.0: the config is no longer a class with statics but an exported
    // INSTANCE. Same contract, an object instead of a namespace.
    if (locale === 'fr') aparteGlobalConfig.setLocale(aparteFr);
    else aparteGlobalConfig.resetLocale(); // back to default (en)
  }, [locale]);

  useEffect(() => window.bonaparte.onBackendStatus(setBackendStatus), []);

  const fail = useCallback((err: unknown, fallbackView: View) => {
    setError(err instanceof Error ? err.message : String(err));
    setView(fallbackView);
  }, []);

  const tryOpen = useCallback(
    async (id?: string, modelPath?: string, nCtx?: number) => {
      setBusy(true);
      setError(null);
      try {
        const reply = await window.bonaparte.openConversation(id, modelPath, nCtx);
        if ('needsModel' in reply) {
          pendingConv.current = reply.conversationId;
          setView('pickModel');
        } else {
          setOpened(reply);
          setLastStats(null);
          setView('chat');
          // The scope follows the open conversation, via its project. The
          // tooling panel only needs the default root.
          const project = await window.bonaparte.currentProject();
          setProjectRoot(project?.root ?? null);
          await refreshConversations();
        }
        setBackendStatus(await window.bonaparte.getBackendStatus());
      } catch (err) {
        fail(err, modelPath ? 'pickModel' : 'setup');
      } finally {
        setBusy(false);
      }
    },
    [fail, refreshConversations],
  );

  /**
   * Switching conversation: READ ONLY. The history comes from the log on
   * disk; the KV cache only speeds up the next generation, so browsing one's
   * conversations must load no model. The engine wakes up on the first
   * message, and not before.
   */
  const selectConversation = useCallback(
    async (id?: string) => {
      setBusy(true);
      setError(null);
      try {
        const history = await window.bonaparte.conversationHistory(id);
        if ('needsModel' in history) {
          pendingConv.current = history.conversationId;
          setView('pickModel');
          return;
        }
        setOpened(history);
        setLastStats(null);
        setView('chat');
        const project = await window.bonaparte.currentProject();
        setProjectRoot(project?.root ?? null);
        await refreshConversations();
      } catch (err) {
        fail(err, 'setup');
      } finally {
        setBusy(false);
      }
    },
    [fail, refreshConversations],
  );

  const startWith = useCallback(
    async (engine: BackendConfigDto) => {
      setBusy(true);
      setError(null);
      try {
        await window.bonaparte.startBackend(engine);
        const existing = await window.bonaparte.getConfig();
        await window.bonaparte.setConfig({ ...existing, backend: engine });
        setConfig(engine);
        setBusy(false);
        await selectConversation();
      } catch (err) {
        setBusy(false);
        fail(err, 'setup');
      }
    },
    [fail, selectConversation],
  );

  // Boot: if an engine is configured, we start it and open the conversation;
  // otherwise, the configuration panel.
  useEffect(() => {
    if (bootAttempted.current) return;
    bootAttempted.current = true;
    void (async () => {
      const appConfig = await window.bonaparte.getConfig();
      if (!appConfig.backend) {
        setView('setup');
        return;
      }
      setConfig(appConfig.backend);
      // COLD startup: we register the engine and show the history, without
      // waking anything. The connection happens on the first message —
      // launching the app must load no model.
      await window.bonaparte.registerBackend(appConfig.backend);
      const history = await window.bonaparte.conversationHistory();
      if ('needsModel' in history) {
        setView('pickModel');
        return;
      }
      setOpened(history);
      setView('chat');
      await refreshConversations();
      setPlugins(await window.bonaparte.listPlugins());
    })();
  }, [startWith, refreshConversations]);


  /** New conversation: it inherits the current folder if there is one —
   *  chatting without a folder remains possible by simply not attaching one.
   *  It doesn't load anything either: it's empty, there's nothing to generate. */
  const createConversation = useCallback(async () => {
    setBusy(true);
    try {
      const project = await window.bonaparte.currentProject();
      const id = await window.bonaparte.createConversation(project?.root);
      await refreshConversations();
      await selectConversation(id);
    } finally {
      setBusy(false);
    }
  }, [refreshConversations, selectConversation]);

  const handleSave = useCallback(async () => {
    const ok = await window.bonaparte.saveKv();
    setSaveState(ok ? 'saved' : 'failed');
    setTimeout(() => setSaveState('idle'), 2500);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-aparte-theme', next);
    document.documentElement.style.colorScheme = next;
    // shiki freezes colors into the HTML of code blocks: without
    // reinstalling, a light theme would keep code on a dark background.
    // Blocks already painted only recolor on the next render.
    void bootstrapHighlighting(next).catch(() => undefined);
    try {
      localStorage.setItem('bp.theme', next);
    } catch {
      /* non-blocking */
    }
  }, []);

  return (
    <div className="app-shell">
      <div className="app-body">
        {/*
          The flanks stay MOUNTED, even when collapsed — their width drops to
          zero, and that's it. This is the only reliable way to animate a
          collapse: mounting then unmounting the element leaves the browser no
          starting state to interpolate from, hence no transition to play.
        */}
        {view === 'chat' && (
            <>
              <div
                className="side-slot"
                data-collapsed={layout.sidebarCollapsed ? 'true' : 'false'}
                aria-hidden={layout.sidebarCollapsed}
                style={{ width: layout.sidebarCollapsed ? 0 : layout.sidebarWidth }}
              >
                <ConversationSidebar
                  conversations={conversations}
                  projects={projects}
                  currentId={opened?.conversationId ?? null}
                  busy={busy || streaming}
                  grouping={grouping}
                  sort={sort}
                  onSelect={(id) => void selectConversation(id)}
                  onCreate={() => void createConversation()}
                  onCreateProject={() => setProjectDialog({ project: null })}
                  onEditProject={(id) => {
                    const found = projects.find((p) => p.id === id);
                    if (found) setProjectDialog({ project: found });
                  }}
                  onGroupingChange={changeGrouping}
                  onSortChange={changeSort}
                />
                <ResizeHandle
                  width={layout.sidebarWidth}
                  bounds={SIDEBAR_BOUNDS}
                  side="end"
                  label={t.layout.resizeSidebar}
                  onResize={layout.setSidebarWidth}
                />
              </div>
            </>
          )}
        <main className="app-main">
        {view === 'setup' || view === 'boot' ? (
          <SetupPanel
            {...(config ? { initial: config } : {})}
            busy={busy || view === 'boot'}
            error={error}
            onSubmit={(engine) => void startWith(engine)}
          />
                ) : view === 'pickModel' ? (
          <ModelPicker
            busy={busy}
            error={error}
            onPick={(modelPath, nCtx) => {
              // The choice also becomes the default for future conversations —
              // the distribution screen won't reappear (Settings hub in J3).
              if (config) {
                void window.bonaparte.setConfig({
                  backend: config,
                  defaultModel: { path: modelPath, nCtx },
                });
              }
              void tryOpen(pendingConv.current, modelPath, nCtx);
            }}
          />
        ) : opened ? (
          /* `app-main` is a flex ROW (it centers the configuration cards):
             without this column, the chat wouldn't take up all the space. */
          <div className="chat-view">
            <ConversationHeader
              title={conversations.find((c) => c.id === opened.conversationId)?.title ?? ''}
              project={currentProjectSummary}
              projects={projects}
              busy={busy}
              onRename={(title) => void renameCurrent(title)}
              onEditProject={() => {
                if (currentProjectSummary) {
                  setProjectDialog({ project: currentProjectSummary });
                }
              }}
              onCreateProject={() => setProjectDialog({ project: null })}
              onMoveToProject={(id) => void moveConversation(id)}
              sidebarCollapsed={layout.sidebarCollapsed}
              panelCollapsed={layout.panelCollapsed}
              onToggleSidebar={layout.toggleSidebar}
              onTogglePanel={layout.togglePanel}
            />
            {/* Keyed by conversation: the chat seeds the library with the
                messages ONCE, at mount. Without a remount, switching
                conversation left the previous thread on screen. */}
            <ChatScreen
              key={opened.conversationId}
              initialEvents={opened.events}
              onStats={setLastStats}
              onStreamingChange={setStreaming}
              mode={mode}
              onModeChange={changeMode}
              modelName={opened.modelName ?? null}
              conversationId={opened.conversationId}
              busy={busy}
              onPickModel={(modelPath) => void tryOpen(opened.conversationId, modelPath)}
            />
          </div>
          ) : null}
        </main>
        {view === 'chat' && (
            <div
              className="side-slot"
              data-collapsed={layout.panelCollapsed ? 'true' : 'false'}
              aria-hidden={layout.panelCollapsed}
              style={{ width: layout.panelCollapsed ? 0 : layout.panelWidth }}
            >
              <ResizeHandle
                width={layout.panelWidth}
                bounds={PANEL_BOUNDS}
                side="start"
                label={t.layout.resizePanel}
                onResize={layout.setPanelWidth}
              />
              <ToolingPanel
                tooling={tooling}
                projectRoot={projectRoot}
                conversationId={opened?.conversationId ?? null}
                onClose={layout.togglePanel}
              />
            </div>
        )}
      </div>
      {settingsOpen && (
        <SettingsHub
          engine={config}
          onChangeEngine={() => {
            setSettingsOpen(false);
            setView('setup');
          }}
          onToggleTheme={toggleTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          project={projectDialog.project}
          busy={busy}
          onSave={(name, roots) => void saveProject(name, roots)}
          {...(projectDialog.project ? { onDelete: () => void deleteProject() } : {})}
          onCancel={() => setProjectDialog(null)}
        />
      )}
      {approval && (
        <ApprovalDialog request={approval} onRespond={respondToApproval} />
      )}
      <StatusStrip
        backendStatus={backendStatus}
        engine={config}
        streaming={streaming}
        modelName={view === 'chat' ? (opened?.modelName ?? null) : null}
        nCtx={view === 'chat' ? (opened?.nCtx ?? null) : null}
        restore={view === 'chat' ? (opened?.restore ?? null) : null}
        lastStats={lastStats}
        saveState={saveState}
        onSave={() => void handleSave()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
}
