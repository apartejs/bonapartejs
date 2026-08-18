import { AparteConfig } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locale-fr';
import type {
  ApprovalRequestDto,
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ConversationOpenResultDto,
  PlayModeDto,
} from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { ChatScreen } from './components/ChatScreen.js';
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
  const { locale, setLocale } = useTranslate();
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
  const [projectName, setProjectName] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequestDto | null>(null);

  useEffect(() => window.bonaparte.onApprovalRequest(setApproval), []);

  useEffect(() => {
    void window.bonaparte.getMode().then(setModeState);
    void window.bonaparte
      .currentProject()
      .then((project) => setProjectName(project?.name ?? null));
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
        }
        setBackendStatus(await window.bonaparte.getBackendStatus());
      } catch (err) {
        fail(err, modelPath ? 'pickModel' : 'setup');
      } finally {
        setBusy(false);
      }
    },
    [fail],
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
        await tryOpen();
      } catch (err) {
        setBusy(false);
        fail(err, 'setup');
      }
    },
    [fail, tryOpen],
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
    })();
  }, [startWith]);

  const openProject = useCallback(async () => {
    const project = await window.bonaparte.openProject();
    if (!project) return;
    setProjectName(project.name);
    // Le projet change l'inventaire d'outils : on rouvre la conversation
    // pour que le delta soit annoncé au modèle.
    await tryOpen();
  }, [tryOpen]);

  const handleSave = useCallback(async () => {
    const ok = await window.bonaparte.saveKv();
    setSaveState(ok ? 'saved' : 'failed');
    setTimeout(() => setSaveState('idle'), 2500);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-aparte-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem('bp.theme', next);
    } catch {
      /* non bloquant */
    }
  }, []);

  return (
    <div className="app-shell">
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
          <ChatScreen
            initialEvents={opened.events}
            onStats={setLastStats}
            onStreamingChange={setStreaming}
          />
        ) : null}
      </main>
      {approval && (
        <ApprovalDialog request={approval} onRespond={respondToApproval} />
      )}
      <StatusStrip
        backendStatus={backendStatus}
        streaming={streaming}
        mode={mode}
        onModeChange={changeMode}
        projectName={projectName}
        onOpenProject={() => void openProject()}
        modelName={view === 'chat' ? (opened?.modelName ?? null) : null}
        restore={view === 'chat' ? (opened?.restore ?? null) : null}
        lastStats={lastStats}
        saveState={saveState}
        onSave={() => void handleSave()}
        onChangeBackend={() => setView('setup')}
        onToggleTheme={toggleTheme}
        onToggleLocale={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
      />
    </div>
  );
}
