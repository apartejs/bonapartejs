import { appInfo, settingsAll, type Locale } from '@aparte/bonaparte-shared';
import '@aparte/core/styles.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setAparteLocale, setupAparte } from './aparte/setup';
import { bridge } from './bridge';
import { messagesFor } from './i18n/index';
import { LOCALE_CHANGED } from './settings/General';
import { applyAppearance } from './theme/appearance';
import './theme/tokens.css';
import './theme/app.css';

/** The window in the language of the interface, followed when the person changes it (Settings, General). */
function Root({ first }: { first: Locale }) {
  const [locale, setLocale] = useState(first);
  useEffect(() => {
    const follow = (): void => {
      void bridge.invoke(appInfo, undefined).then((info) => {
        document.documentElement.lang = info.locale;
        setAparteLocale(info.locale);
        setLocale(info.locale);
      });
    };
    window.addEventListener(LOCALE_CHANGED, follow);
    return () => window.removeEventListener(LOCALE_CHANGED, follow);
  }, []);
  return <App messages={messagesFor(locale)} locale={locale} />;
}

async function start(): Promise<void> {
  // The theme follows Windows until the settings are read; then the look the person left.
  applyAppearance({ theme: 'system' });
  const [info, settings] = await Promise.all([
    bridge.invoke(appInfo, undefined),
    bridge.invoke(settingsAll, undefined).catch(() => []),
  ]);
  applyAppearance(Object.fromEntries(settings.map((entry) => [entry.key, entry.value])));
  document.documentElement.lang = info.locale;
  setupAparte(info.locale);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root first={info.locale} />
    </StrictMode>,
  );
}

void start();
