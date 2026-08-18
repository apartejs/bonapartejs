import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import {
  createContext,
  useCallback,
  useContext,
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
    /* localStorage indisponible : détection navigateur */
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
      /* non bloquant */
    }
    document.documentElement.lang = next;
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
  if (!ctx) throw new Error('useTranslate doit être utilisé sous <LocaleProvider>');
  return ctx;
}
