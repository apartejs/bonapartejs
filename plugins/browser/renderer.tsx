import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BrowserState {
  url: string | null;
  open: boolean;
  messages: { level: string; text: string; at: string }[];
  /** Message du dernier chargement qui a échoué, s'il y en a un. */
  error?: string;
}

const LABELS = {
  fr: {
    title: 'Navigateur',
    placeholder: 'localhost:5173',
    go: 'Ouvrir',
    close: 'Fermer',
    hint: 'La page s’affiche par-dessus ce panneau. L’agent peut en lire la console et le DOM.',
    failed: 'Chargement impossible :',
    console: 'Console',
    quiet: 'Rien dans la console.',
  },
  en: {
    title: 'Browser',
    placeholder: 'localhost:5173',
    go: 'Open',
    close: 'Close',
    hint: 'The page renders on top of this panel. The agent can read its console and DOM.',
    failed: 'Could not load:',
    console: 'Console',
    quiet: 'Nothing in the console.',
  },
} as const;

/**
 * Navigateur outillé — côté React.
 *
 * La page est une vue NATIVE : elle n'est pas dans le DOM, donc rien ne la
 * suit quand la fenêtre bouge. Ce composant réserve une zone et envoie son
 * rectangle au main à chaque changement de taille.
 *
 * Le rectangle part dès le MONTAGE, sans attendre qu'une page soit chargée.
 * C'est la moitié Node qui décide de poser la vue quand elle en reçoit un — et
 * elle ne pose rien sans. L'inverse (n'envoyer le rectangle qu'une fois la page
 * ouverte) laissait une vue sans place dès que l'ouverture échouait, et une vue
 * sans place occupe toute la fenêtre : l'application disparaissait derrière
 * une page blanche.
 */
export default function BrowserView({ locale, instanceId }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [url, setUrl] = useState('');
  const [state, setState] = useState<BrowserState>({ url: null, open: false, messages: [] });
  const slotRef = useRef<HTMLDivElement>(null);

  // Chaque commande porte l'onglet : le panneau permet d'ouvrir plusieurs
  // navigateurs, et deux pages natives sur la même fenêtre doivent savoir
  // laquelle est laquelle.
  const invoke = useCallback(
    (command: string, payload?: Record<string, unknown>) =>
      window.bonaparte.invokePlugin('browser', command, { ...payload, instanceId }),
    [instanceId],
  );

  const sendBounds = useCallback(() => {
    const element = slotRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void invoke('bounds', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [invoke]);

  useEffect(() => {
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
  }, [sendBounds]);

  useEffect(() => {
    const timer = setInterval(() => {
      void invoke('state').then((next) =>
        // Le message d'échec survit à la scrutation : c'est la seule trace
        // qu'a l'utilisateur, et elle ne doit pas s'effacer au bout d'une
        // seconde. Une ouverture réussie la remplace.
        setState((current) => ({ ...(next as BrowserState), error: current.error })),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [invoke]);

  // On quitte l'onglet : la page reste chargée mais QUITTE la fenêtre. Sans
  // ça, une vue native — qui n'est pas dans le DOM — resterait posée par-dessus
  // l'onglet suivant.
  useEffect(
    () => () => {
      void invoke('detach');
    },
    [invoke],
  );

  const open = useCallback(async () => {
    if (!url.trim()) return;
    const reply = (await invoke('open', { url })) as { url?: string; error?: string };
    // L'état complet arrive au tour de scrutation suivant ; ce qui compte ici
    // est que la zone existe pour recevoir la vue native, et que l'échec
    // éventuel se dise.
    setState((current) => ({
      ...current,
      url: reply.url ?? current.url,
      open: true,
      ...(reply.error ? { error: reply.error } : { error: undefined }),
    }));
  }, [invoke, url]);

  const close = useCallback(async () => {
    await invoke('close');
    setState({ url: null, open: false, messages: [] });
  }, [invoke]);

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
        {state.error ? (
          <p className="browser-failed">
            {labels.failed} {state.error}
          </p>
        ) : (
          !state.open && <p className="setting-help">{labels.hint}</p>
        )}
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
