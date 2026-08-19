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
    open: 'Ouvrir',
    exited: 'terminé',
    starting: 'démarrage…',
  },
  en: {
    title: 'Project scripts',
    noProject: 'Open a folder to see its scripts.',
    none: 'This project declares no script.',
    run: 'Run',
    stop: 'Stop',
    open: 'Open',
    exited: 'exited',
    starting: 'starting…',
  },
} as const;

/**
 * Nouvel-onglet projet-aware : les scripts du dossier ouvert, lançables d'un
 * clic. L'URL n'apparaît que lorsque le serveur l'a réellement annoncée dans
 * sa sortie — proposer un lien avant qu'il n'écoute serait deviner.
 */
export default function ProjectLauncherView({ projectRoot, locale }: ToolingViewProps) {
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
    // Les serveurs de dev annoncent leur URL avec un délai : on relit
    // périodiquement plutôt que de figer un état incomplet.
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
              <li className="script-card" key={script.name}>
                <div className="script-head">
                  <span className="script-name">{script.name}</span>
                  {live ? (
                    <button type="button" onClick={() => void stop(script.name)}>
                      {labels.stop}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void run(script.name)}>
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
                      <span className="script-exited">
                        {labels.exited} ({live.exitCode})
                      </span>
                    ) : live.url ? (
                      <button
                        type="button"
                        className="script-url"
                        onClick={() => void window.bonaparte.openExternal(live.url as string)}
                      >
                        {labels.open} {live.url}
                      </button>
                    ) : (
                      <span className="script-pending">{labels.starting}</span>
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
