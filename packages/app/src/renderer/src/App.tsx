import { AparteConfig } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locale-fr';
import type {
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ConversationOpenResultDto,
} from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
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
        await window.bonaparte.setConfig({ backend: engine });
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
      if (appConfig.backend) {
        setConfig(appConfig.backend);
        await startWith(appConfig.backend);
      } else {
        setView('setup');
      }
    })();
  }, [startWith]);

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
            onPick={(modelPath, nCtx) =>
              void tryOpen(pendingConv.current, modelPath, nCtx)
            }
          />
        ) : opened ? (
          <ChatScreen
            initialEvents={opened.events}
            onStats={setLastStats}
            onStreamingChange={setStreaming}
          />
        ) : null}
      </main>
      <StatusStrip
        backendStatus={backendStatus}
        streaming={streaming}
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
