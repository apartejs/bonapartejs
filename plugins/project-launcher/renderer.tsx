import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { Badge, Button } from '@aparte/bonaparte-plugin-sdk/ui';
import { ExternalLink, Play, Square } from 'lucide-react';
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

const HELP = 'setting-help text-[11.5px] leading-snug text-muted-foreground';
const SOFT_PRIMARY = 'bg-accent text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground';
const SOFT_DANGER = 'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive';

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

  if (!projectRoot) return <p className={HELP}>{labels.noProject}</p>;
  if (!state) return null;

  const runningByName = new Map(state.running.map((entry) => [entry.name, entry]));

  return (
    <div className="plugin-view flex flex-col gap-2.5">
      <h3 className="plugin-view-title font-serif text-sm font-normal text-muted-foreground">{labels.title}</h3>
      {state.scripts.length === 0 ? (
        <p className={HELP}>{labels.none}</p>
      ) : (
        <ul className="script-list flex flex-col gap-2">
          {state.scripts.map((script) => {
            const live = runningByName.get(script.name);
            return (
              <li
                className="script-card flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2.5"
                key={script.name}
              >
                <div className="script-head flex items-center justify-between gap-2">
                  <span className="script-name text-[13.5px]">{script.name}</span>
                  {live ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={SOFT_DANGER}
                      onClick={() => void stop(script.name)}
                    >
                      <Square className="size-3" aria-hidden="true" />
                      {labels.stop}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={SOFT_PRIMARY}
                      onClick={() => void run(script.name)}
                    >
                      <Play className="size-3.5" aria-hidden="true" />
                      {labels.run}
                    </Button>
                  )}
                </div>
                <code className="script-command font-mono text-[11px] text-muted-foreground">
                  {state.manager} run {script.name}
                </code>
                {live && (
                  <div className="script-state text-[11.5px]">
                    {live.exitCode !== null ? (
                      <Badge variant="destructive" className="script-exited font-mono text-[11px] font-normal">
                        {labels.exited} ({live.exitCode})
                      </Badge>
                    ) : live.url ? (
                      <span className="script-links flex min-w-0 flex-wrap items-center gap-1.5">
                        <code className="script-url truncate font-mono text-[11.5px] text-muted-foreground">
                          {live.url}
                        </code>
                        {/* Inside bonaparte first — the agent can read that page;
                            the OS browser stays one click away. */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={SOFT_PRIMARY}
                          onClick={() => {
                            if (!openView?.('browser', 'page', { url: live.url })) {
                              void window.bonaparte.openExternal(live.url as string);
                            }
                          }}
                        >
                          {labels.open}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-7 text-muted-foreground"
                          aria-label={labels.openOutside}
                          title={labels.openOutside}
                          onClick={() => void window.bonaparte.openExternal(live.url as string)}
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="script-pending font-mono text-[11px] font-normal text-muted-foreground"
                      >
                        {labels.starting}
                      </Badge>
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
