import { AparteConfig } from '@aparte/core';
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

type View = 'boot' | 'setup' | 'pickModel' | 'chat';

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-aparte-theme') === 'dark'
    ? 'dark'
    : 'light';
}

export function App() {
  const { locale } = useTranslate();
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
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  /** null = fermé ; { project: null } = création. */
  const [projectDialog, setProjectDialog] = useState<{
    project: ProjectSummaryDto | null;
  } | null>(null);
  // Organisation du menu : pure préférence d'affichage, donc locale — la
  // remonter au main process ferait redémarrer l'app pour un réglage cosmétique.
  const [grouping, setGrouping] = useState<SidebarGroupingDto>(
    () => (localStorage.getItem('bp.sidebar.grouping') as SidebarGroupingDto) || 'project',
  );
  const [sort, setSort] = useState<SidebarSortDto>(
    () => (localStorage.getItem('bp.sidebar.sort') as SidebarSortDto) || 'updated',
  );

  /** Le menu se relit après chaque événement qui peut le changer. */
  const refreshConversations = useCallback(async () => {
    setConversations(await window.bonaparte.listConversations());
    setProjects(await window.bonaparte.listProjects());
  }, []);

  const changeGrouping = useCallback((next: SidebarGroupingDto) => {
    setGrouping(next);
    try {
      localStorage.setItem('bp.sidebar.grouping', next);
    } catch {
      /* non bloquant */
    }
  }, []);

  const changeSort = useCallback((next: SidebarSortDto) => {
    setSort(next);
    try {
      localStorage.setItem('bp.sidebar.sort', next);
    } catch {
      /* non bloquant */
    }
  }, []);

  /**
   * Enregistre un projet — création ou édition — puis rafraîchit tout : le
   * périmètre a pu changer, donc le menu ET l'en-tête.
   */
  const saveProject = useCallback(
    async (name: string, roots: string[]) => {
      const editing = projectDialog?.project ?? null;
      if (editing) {
        await window.bonaparte.renameProject(editing.id, name);
        await window.bonaparte.setProjectRoots(editing.id, roots);
      } else {
        const created = await window.bonaparte.createProject(name, roots);
        // Un projet créé depuis une conversation sans projet l'adopte : sinon
        // l'utilisateur créerait un projet qui ne sert à rien dans l'instant.
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

  /** Projet de la conversation ouverte, tiré de l'index déjà chargé. */
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

  // Locale des composants aparté (chaînes internes des web components).
  useEffect(() => {
    if (locale === 'fr') AparteConfig.setLocale(aparteFr);
    else AparteConfig.resetLocale(); // 0.3.0-alpha.0 — retour au défaut (en)
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
          // Le périmètre suit la conversation ouverte, via son projet. Le
          // panneau d'outillage n'a besoin que de la racine par défaut.
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
   * Bascule de conversation : LECTURE SEULE. L'historique vient du log sur
   * disque ; le cache KV n'accélère que la génération suivante, donc consulter
   * ses conversations ne doit charger aucun modèle. Le moteur se réveille au
   * premier message, et pas avant.
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

  // Boot : si un moteur est configuré, on le démarre et on ouvre la
  // conversation ; sinon, panneau de configuration.
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
      // Démarrage à FROID : on enregistre le moteur et on affiche
      // l'historique, sans rien réveiller. La connexion se fait au premier
      // message — lancer l'app ne doit charger aucun modèle.
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


  /** Nouvelle conversation : elle hérite du dossier courant s'il y en a un —
   *  discuter sans dossier reste possible en n'en attachant simplement pas.
   *  Elle non plus ne charge rien : elle est vide, il n'y a rien à générer. */
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
    // shiki fige les couleurs dans le HTML des blocs de code : sans
    // réinstallation, un thème clair garderait du code sur fond sombre. Les
    // blocs déjà peints ne se recolorent qu'au prochain rendu.
    void bootstrapHighlighting(next).catch(() => undefined);
    try {
      localStorage.setItem('bp.theme', next);
    } catch {
      /* non bloquant */
    }
  }, []);

  return (
    <div className="app-shell">
      <div className="app-body">
        {view === 'chat' && (
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
              // Le choix devient aussi le défaut des futures conversations —
              // l'écran de distribution ne réapparaîtra plus (hub Réglages en J3).
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
          /* `app-main` est un flex ROW (il centre les cartes de configuration) :
             sans cette colonne, l'en-tête et le chat se retrouvent côte à côte. */
          <div className="chat-view">
            <ConversationHeader
              title={
                conversations.find((c) => c.id === opened.conversationId)?.title ?? ''
              }
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
            />
            <ChatScreen
              initialEvents={opened.events}
              onStats={setLastStats}
              onStreamingChange={setStreaming}
              mode={mode}
              onModeChange={changeMode}
              modelName={opened.modelName ?? null}
            />
          </div>
          ) : null}
        </main>
        {view === 'chat' && (
          <ToolingPanel
            plugins={plugins}
            projectRoot={projectRoot}
            conversationId={opened?.conversationId ?? null}
          />
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
