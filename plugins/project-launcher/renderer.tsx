import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useState } from 'react';

interface ScriptEntry {
  name: string;
  command: string;
}

interface RunningEntry {
  name: string;
  url: string | null;
  exitCode: number | null;
  output: string[];
}

interface ScriptsReply {
  scripts: ScriptEntry[];
  manager: string;
  running: RunningEntry[];
}

const LABELS = {
  fr: {
    title: 'Scripts du projet',
    noProject: 'Ouvrez un dossier pour voir ses scripts.',
    none: 'Ce projet ne déclare aucun script.',
    run: 'Lancer',
    stop: 'Arrêter',
    open: 'Ouvrir dans le navigateur',
    openOutside: 'Ouvrir à l’extérieur',
    exited: 'terminé',
    starting: 'démarrage…',
  },
  en: {
    title: 'Project scripts',
    noProject: 'Open a folder to see its scripts.',
    none: 'This project declares no script.',
    run: 'Run',
    stop: 'Stop',
    open: 'Open in the browser',
    openOutside: 'Open outside',
    exited: 'exited',
    starting: 'starting…',
  },
} as const;

/**
 * Project-aware new-tab: the open folder's scripts, launchable with one
 * click. The URL only appears once the server has actually announced it in
 * its output — offering a link before it is listening would be a guess.
 */
export default function ProjectLauncherView({ projectRoot, locale, openView }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [state, setState] = useState<ScriptsReply | null>(null);

  const refresh = useCallback(async () => {
    if (!projectRoot) {
      setState(null);
      return;
    }
    setState(
      (await window.bonaparte.invokePlugin('project-launcher', 'scripts', {
        projectRoot,
      })) as ScriptsReply,
    );
  }, [projectRoot]);

  useEffect(() => {
    void refresh();
    // Dev servers announce their URL with a delay: we poll periodically
    // rather than freezing an incomplete state.
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (script: string) => {
      await window.bonaparte.invokePlugin('project-launcher', 'run', {
        projectRoot,
        script,
      });
      await refresh();
    },
    [projectRoot, refresh],
  );

  const stop = useCallback(
    async (script: string) => {
      await window.bonaparte.invokePlugin('project-launcher', 'stop', { script });
      await refresh();
    },
    [refresh],
  );

  if (!projectRoot) return <p className="setting-help">{labels.noProject}</p>;
  if (!state) return null;

  const runningByName = new Map(state.running.map((entry) => [entry.name, entry]));

  return (
    <div className="plugin-view">
      <h3 className="plugin-view-title">{labels.title}</h3>
      {state.scripts.length === 0 ? (
        <p className="setting-help">{labels.none}</p>
      ) : (
        <ul className="script-list">
          {state.scripts.map((script) => {
            const live = runningByName.get(script.name);
            return (
              <li className="script-card aparte-card" key={script.name}>
                <div className="script-head">
                  <span className="script-name">{script.name}</span>
                  {live ? (
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--danger aparte-btn--soft aparte-btn--sm"
                      onClick={() => void stop(script.name)}
                    >
                      {labels.stop}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--primary aparte-btn--soft aparte-btn--sm"
                      onClick={() => void run(script.name)}
                    >
                      ▶ {labels.run}
                    </button>
                  )}
                </div>
                <code className="script-command">
                  {state.manager} run {script.name}
                </code>
                {live && (
                  <div className="script-state">
                    {live.exitCode !== null ? (
                      <span className="script-exited aparte-badge aparte-badge--danger aparte-badge--soft aparte-badge--sm">
                        {labels.exited} ({live.exitCode})
                      </span>
                    ) : live.url ? (
                      <span className="script-links">
                        <code className="script-url">{live.url}</code>
                        {/* Inside bonaparte first — the agent can read that page;
                            the OS browser stays one click away. */}
                        <button
                          type="button"
                          className="aparte-btn aparte-btn--primary aparte-btn--soft aparte-btn--sm"
                          onClick={() => {
                            if (!openView?.('browser', 'page', { url: live.url })) {
                              void window.bonaparte.openExternal(live.url as string);
                            }
                          }}
                        >
                          {labels.open}
                        </button>
                        <button
                          type="button"
                          className="aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--icon aparte-btn--sm"
                          aria-label={labels.openOutside}
                          title={labels.openOutside}
                          onClick={() => void window.bonaparte.openExternal(live.url as string)}
                        >
                          ↗
                        </button>
                      </span>
                    ) : (
                      <span className="script-pending aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm">
                        {labels.starting}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
