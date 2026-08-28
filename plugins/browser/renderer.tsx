import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BrowserState {
  url: string | null;
  open: boolean;
  messages: { level: string; text: string; at: string }[];
  /** Message of the last load that failed, if any. */
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
 * Tooled browser — React side.
 *
 * The page is a NATIVE view: it isn't in the DOM, so nothing follows it
 * when the window moves. This component reserves a zone and sends its
 * rectangle to the main process on every size change.
 *
 * The rectangle is sent right from MOUNT, without waiting for a page to be
 * loaded. It's the Node half that decides to place the view once it
 * receives one — and it places nothing without one. The opposite (only
 * sending the rectangle once a page had opened) left the view with no place
 * as soon as the opening failed, and a view with no place takes over the
 * whole window: the application would disappear behind a blank page.
 */
export default function BrowserView({ locale, instanceId }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [url, setUrl] = useState('');
  const [state, setState] = useState<BrowserState>({ url: null, open: false, messages: [] });
  const slotRef = useRef<HTMLDivElement>(null);

  // Every command carries the tab: the panel allows opening several
  // browsers, and two native pages on the same window need to know which
  // is which.
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
    // The panel can also move without changing size (the menu collapsing):
    // a regular refresh costs less than a misplaced page.
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
        // The failure message survives polling: it's the only trace the
        // user has, and it must not vanish after a second. A successful
        // opening replaces it.
        setState((current) => ({ ...(next as BrowserState), error: current.error })),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [invoke]);

  // We're leaving the tab: the page stays loaded but LEAVES the window.
  // Without this, a native view — which isn't in the DOM — would stay
  // sitting on top of the next tab.
  useEffect(
    () => () => {
      void invoke('detach');
    },
    [invoke],
  );

  const open = useCallback(async () => {
    if (!url.trim()) return;
    const reply = (await invoke('open', { url })) as { url?: string; error?: string };
    // The full state arrives on the next polling round; what matters here
    // is that the zone exists to receive the native view, and that any
    // failure gets reported.
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
        className="browser-bar aparte-field-group"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <input
          className="browser-url aparte-field aparte-field--sm"
          value={url}
          placeholder={labels.placeholder}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="aparte-field-group__suffix aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm"
        >
          {labels.go}
        </button>
        {state.open && (
          <button
            type="button"
            className="aparte-btn aparte-btn--neutral aparte-btn--outline aparte-btn--sm"
            onClick={() => void close()}
          >
            {labels.close}
          </button>
        )}
      </form>

      {/* Reserved zone: the native view lands exactly here. */}
      <div className="browser-slot" ref={slotRef}>
        {state.error ? (
          <div className="browser-failed aparte-alert aparte-alert--danger" role="alert">
            <div className="aparte-alert__body">
              <p className="aparte-alert__message">
                {labels.failed} {state.error}
              </p>
            </div>
          </div>
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
