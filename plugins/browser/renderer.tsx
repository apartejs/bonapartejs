import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BrowserState {
  url: string | null;
  open: boolean;
  messages: { level: string; text: string; at: string }[];
}

const LABELS = {
  fr: {
    title: 'Navigateur',
    placeholder: 'localhost:5173',
    go: 'Ouvrir',
    close: 'Fermer',
    hint: 'La page s’affiche par-dessus ce panneau. L’agent peut en lire la console et le DOM.',
    console: 'Console',
    quiet: 'Rien dans la console.',
  },
  en: {
    title: 'Browser',
    placeholder: 'localhost:5173',
    go: 'Open',
    close: 'Close',
    hint: 'The page renders on top of this panel. The agent can read its console and DOM.',
    console: 'Console',
    quiet: 'Nothing in the console.',
  },
} as const;

/**
 * Navigateur outillé — côté React.
 *
 * La page est une vue NATIVE : elle n'est pas dans le DOM, donc rien ne la
 * suit quand la fenêtre bouge. Ce composant réserve une zone et envoie son
 * rectangle au main à chaque changement de taille ; sans ça, la page se
 * retrouverait posée n'importe où sur la fenêtre.
 */
export default function BrowserView({ locale }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [url, setUrl] = useState('');
  const [state, setState] = useState<BrowserState>({ url: null, open: false, messages: [] });
  const slotRef = useRef<HTMLDivElement>(null);

  const sendBounds = useCallback(() => {
    const element = slotRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void window.bonaparte.invokePlugin('browser', 'bounds', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    if (!state.open) return;
    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    if (slotRef.current) observer.observe(slotRef.current);
    window.addEventListener('resize', sendBounds);
    // Le panneau peut aussi bouger sans changer de taille (repli du menu) :
    // un rafraîchissement régulier coûte moins qu'une page mal placée.
    const timer = setInterval(sendBounds, 1000);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sendBounds);
      clearInterval(timer);
    };
  }, [state.open, sendBounds]);

  useEffect(() => {
    const timer = setInterval(() => {
      void window.bonaparte
        .invokePlugin('browser', 'state')
        .then((next) => setState(next as BrowserState));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const open = useCallback(async () => {
    if (!url.trim()) return;
    setState(
      (await window.bonaparte.invokePlugin('browser', 'open', { url })) as BrowserState,
    );
    // L'état complet arrive au tour de scrutation suivant ; ce qui compte
    // ici est que la zone existe pour recevoir la vue native.
    setState((current) => ({ ...current, open: true }));
  }, [url]);

  const close = useCallback(async () => {
    await window.bonaparte.invokePlugin('browser', 'close');
    setState({ url: null, open: false, messages: [] });
  }, []);

  return (
    <div className="plugin-view browser-view">
      <form
        className="browser-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <input
          className="browser-url"
          value={url}
          placeholder={labels.placeholder}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit">{labels.go}</button>
        {state.open && (
          <button type="button" onClick={() => void close()}>
            {labels.close}
          </button>
        )}
      </form>

      {/* Zone réservée : la vue native vient se poser exactement ici. */}
      <div className="browser-slot" ref={slotRef}>
        {!state.open && <p className="setting-help">{labels.hint}</p>}
      </div>

      {state.open && (
        <details className="browser-console">
          <summary>
            {labels.console} ({state.messages.length})
          </summary>
          {state.messages.length === 0 ? (
            <p className="setting-help">{labels.quiet}</p>
          ) : (
            <ul className="browser-console-list">
              {state.messages.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={`console-${entry.level}`}>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
