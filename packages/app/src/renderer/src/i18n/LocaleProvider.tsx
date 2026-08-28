import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { APP_LOCALES, type AppTranslations } from './translations.js';

const STORAGE_KEY = 'bp.locale';

function initialLocale(): BonaparteLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    /* localStorage unavailable: browser detection */
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

interface LocaleContextValue {
  locale: BonaparteLocale;
  t: AppTranslations;
  setLocale: (locale: BonaparteLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<BonaparteLocale>(initialLocale);

  const setLocale = useCallback((next: BonaparteLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-blocking */
    }
    document.documentElement.lang = next;
    // The harness needs the locale: it decides the language the model
    // replies in (the protocol itself stays English).
    void window.bonaparte?.getConfig().then((config) =>
      window.bonaparte.setConfig({ ...config, locale: next }),
    );
  }, []);

  // The stored config is the durable choice, shared with the main process
  // (it names the native dialogs' filters and picks the model's reply
  // language). When it names a locale, the renderer follows it — a config
  // edited by hand, or written by a test, must win over what the browser
  // guessed. When it names none, the renderer's detection is written there
  // once, so the main process knows the language from the start.
  useEffect(() => {
    void window.bonaparte?.getConfig().then((config) => {
      if (config.locale === 'fr' || config.locale === 'en') {
        if (config.locale !== locale) {
          setLocaleState(config.locale);
          document.documentElement.lang = config.locale;
          try {
            localStorage.setItem(STORAGE_KEY, config.locale);
          } catch {
            /* non-blocking */
          }
        }
        return;
      }
      void window.bonaparte.setConfig({ ...config, locale });
    });
    // Mount only: switches go through setLocale, which writes the config itself.
  }, []);

  const value = useMemo(
    () => ({ locale, t: APP_LOCALES[locale], setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useTranslate(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useTranslate must be used under <LocaleProvider>');
  return ctx;
}
