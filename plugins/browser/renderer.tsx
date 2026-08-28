import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BrowserState {
  url: string | null;
  open: boolean;
  messages: { level: string; text: string; at: string }[];
  /** Message of the last load that failed, if any. */
  error?: string;
}

interface ScriptEntry {
  name: string;
  command: string;
}

interface RunningEntry {
  name: string;
  url: string | null;
  exitCode: number | null;
}

interface ScriptsReply {
  scripts: ScriptEntry[];
  running: RunningEntry[];
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
    scripts: 'Lancer un script du projet et ouvrir sa page',
    following: 'Script lancé — en attente de son adresse…',
    gaveUp: 'Le script n’a annoncé aucune adresse. Son journal est dans l’onglet Projet.',
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
    scripts: 'Run a project script and open its page',
    following: 'Script started — waiting for its address…',
    gaveUp: 'The script announced no address. Its output is in the Project tab.',
  },
} as const;

/** How long a followed script gets to announce its address. */
const FOLLOW_TIMEOUT_MS = 60_000;

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
 *
 * With no page yet, the tab offers the project's scripts: one click runs
 * one and FOLLOWS it — the page opens here the moment the server announces
 * its address. Opened by the launcher with a URL, it shows it at once.
 */
export default function BrowserView({ locale, instanceId, projectRoot, init }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [url, setUrl] = useState('');
  const [state, setState] = useState<BrowserState>({ url: null, open: false, messages: [] });
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [following, setFollowing] = useState<string | null>(
    typeof init?.['followScript'] === 'string' ? (init['followScript'] as string) : null,
  );
  const [gaveUp, setGaveUp] = useState(false);
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

  const openUrl = useCallback(
    async (target: string) => {
      if (!target.trim()) return;
      setUrl(target);
      const reply = (await invoke('open', { url: target })) as { url?: string; error?: string };
      // The full state arrives on the next polling round; what matters here
      // is that the zone exists to receive the native view, and that any
      // failure gets reported.
      setState((current) => ({
        ...current,
        url: reply.url ?? current.url,
        open: true,
        ...(reply.error ? { error: reply.error } : { error: undefined }),
      }));
    },
    [invoke],
  );

  // Opened with a URL by another view: show it at once.
  const initialUrl = typeof init?.['url'] === 'string' ? (init['url'] as string) : null;
  useEffect(() => {
    if (initialUrl) void openUrl(initialUrl);
  }, [initialUrl, openUrl]);

  // The project's scripts, from the launcher plugin — nothing when it is off.
  useEffect(() => {
    if (!projectRoot) {
      setScripts([]);
      return;
    }
    let cancelled = false;
    void window.bonaparte
      .invokePlugin('project-launcher', 'scripts', { projectRoot })
      .then((reply) => {
        if (!cancelled) setScripts((reply as ScriptsReply).scripts ?? []);
      })
      .catch(() => {
        if (!cancelled) setScripts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  // Following a script: poll the launcher until the server announces its
  // address, then open it here. A script that never does gets a word, not
  // a spinner for ever.
  useEffect(() => {
    if (!following || !projectRoot) return;
    let cancelled = false;
    const started = Date.now();
    const timer = setInterval(() => {
      void window.bonaparte
        .invokePlugin('project-launcher', 'scripts', { projectRoot })
        .then((reply) => {
          if (cancelled) return;
          const live = (reply as ScriptsReply).running.find((entry) => entry.name === following);
          if (live?.url) {
            setFollowing(null);
            void openUrl(live.url);
          } else if (!live || live.exitCode !== null || Date.now() - started > FOLLOW_TIMEOUT_MS) {
            setFollowing(null);
            setGaveUp(true);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [following, projectRoot, openUrl]);

  const runAndFollow = async (script: string): Promise<void> => {
    if (!projectRoot) return;
    setGaveUp(false);
    await window.bonaparte.invokePlugin('project-launcher', 'run', { projectRoot, script });
    setFollowing(script);
  };

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
          void openUrl(url);
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
          !state.open && (
            <div className="browser-empty">
              {following ? (
                <p className="browser-following">
                  <span className="aparte-spinner aparte-spinner--sm" aria-hidden="true" />{' '}
                  {labels.following}
                </p>
              ) : (
                scripts.length > 0 && (
                  <section className="browser-scripts">
                    <p className="browser-scripts-title">{labels.scripts}</p>
                    <ul className="browser-script-list">
                      {scripts.map((script) => (
                        <li key={script.name}>
                          <button
                            type="button"
                            className="browser-script aparte-btn aparte-btn--primary aparte-btn--soft aparte-btn--sm"
                            onClick={() => void runAndFollow(script.name)}
                            title={script.command}
                          >
                            <span aria-hidden="true">▶</span> {script.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              )}
              {gaveUp && <p className="setting-help">{labels.gaveUp}</p>}
              <p className="setting-help">{labels.hint}</p>
            </div>
          )
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
                <li key={entry.at + '-' + index} className={'console-' + entry.level}>
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
