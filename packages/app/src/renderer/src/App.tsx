import { useEffect, useState } from 'react';
import { useTranslate } from './i18n/LocaleProvider.js';

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-aparte-theme') === 'dark'
    ? 'dark'
    : 'light';
}

export function App() {
  const { locale, t, setLocale } = useTranslate();
  const [version, setVersion] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(currentTheme);

  useEffect(() => {
    void window.bonaparte.getVersion().then(setVersion);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-aparte-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem('bp.theme', next);
    } catch {
      /* non bloquant */
    }
    setTheme(next);
  };

  return (
    <main className="hero">
      <div className="hero-card">
        <p className="bp-eyebrow">bonaparte {version && `v${version}`}</p>
        <h1 className="wordmark">
          <span className="mascot">{"('.')"}</span> bonaparte
        </h1>
        <p className="tagline">{t.app.tagline}</p>
        <p className="note">{t.app.scaffoldNote}</p>
        <div className="hero-actions">
          <button type="button" onClick={toggleTheme}>
            {t.actions.toggleTheme}
          </button>
          <button
            type="button"
            onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
          >
            {t.actions.toggleLocale}
          </button>
        </div>
      </div>
    </main>
  );
}
