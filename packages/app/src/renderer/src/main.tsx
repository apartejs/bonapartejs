import { appInfo } from '@aparte/bonaparte-shared';
import '@aparte/core/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupAparte } from './aparte/setup';
import { bridge } from './bridge';
import { messagesFor } from './i18n/index';
import './theme/tokens.css';
import './theme/app.css';

/** The theme follows the system until the person chooses one (Settings, Appearance). */
function followSystemTheme(): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (): void => {
    document.documentElement.dataset['aparteTheme'] = dark.matches ? 'dark' : 'light';
  };
  apply();
  dark.addEventListener('change', apply);
}

async function start(): Promise<void> {
  followSystemTheme();
  const info = await bridge.invoke(appInfo, undefined);
  document.documentElement.lang = info.locale;
  setupAparte(info.locale);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App messages={messagesFor(info.locale)} locale={info.locale} />
    </StrictMode>,
  );
}

void start();
