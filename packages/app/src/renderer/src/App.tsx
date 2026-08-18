import { AparteConfig, DEFAULT_LOCALE } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locale-fr';
import type {
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ConversationOpenResultDto,
} from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatScreen } from './components/ChatScreen.js';
import { SetupPanel } from './components/SetupPanel.js';
import { StatusStrip } from './components/StatusStrip.js';
import { useTranslate } from './i18n/LocaleProvider.js';

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-aparte-theme') === 'dark'
    ? 'dark'
    : 'light';
}

export function App() {
  const { locale, setLocale } = useTranslate();
  const [backendStatus, setBackendStatus] = useState<BackendStatusDto>('stopped');
  const [opened, setOpened] = useState<ConversationOpenResultDto | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<CompletionStatsDto | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [config, setConfig] = useState<BackendConfigDto | undefined>(undefined);
  const bootAttempted = useRef(false);

  // Locale des composants aparté (chaînes internes des web components).
  useEffect(() => {
    AparteConfig.setLocale(locale === 'fr' ? aparteFr : DEFAULT_LOCALE);
  }, [locale]);

  useEffect(() => window.bonaparte.onBackendStatus(setBackendStatus), []);

  const startWith = useCallback(async (backendConfig: BackendConfigDto) => {
    setSetupBusy(true);
    setSetupError(null);
    try {
      await window.bonaparte.startBackend(backendConfig);
      await window.bonaparte.setConfig({ backend: backendConfig });
      setConfig(backendConfig);
      const result = await window.bonaparte.openConversation();
      setOpened(result);
      setShowSetup(false);
      setBackendStatus(await window.bonaparte.getBackendStatus());
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error));
      setShowSetup(true);
    } finally {
      setSetupBusy(false);
    }
  }, []);

  // Boot : si un backend est configuré, on le démarre et on ouvre la
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
        setShowSetup(true);
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
        {showSetup || !opened ? (
          <SetupPanel
            {...(config ? { initial: config } : {})}
            busy={setupBusy}
            error={setupError}
            onSubmit={(c) => void startWith(c)}
          />
        ) : (
          <ChatScreen
            initialEvents={opened.events}
            onStats={setLastStats}
            onStreamingChange={setStreaming}
          />
        )}
      </main>
      <StatusStrip
        backendStatus={backendStatus}
        streaming={streaming}
        restore={opened?.restore ?? null}
        lastStats={lastStats}
        saveState={saveState}
        onSave={() => void handleSave()}
        onChangeBackend={() => setShowSetup(true)}
        onToggleTheme={toggleTheme}
        onToggleLocale={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
      />
    </div>
  );
}
