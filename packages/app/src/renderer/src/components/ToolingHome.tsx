import { Button, Kbd } from '@aparte/bonaparte-plugin-sdk/ui';
import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';

interface ToolingHomeProps {
  tooling: ToolingTabsApi;
  projectRoot: string | null;
}

interface ScriptEntry {
  name: string;
  command: string;
}

/** A soft primary: the accent wash, for the one action a row invites. */
export const SOFT_PRIMARY =
  'bg-accent text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground';

/**
 * The panel with no tab open: not an empty sentence, but what the panel can
 * do — every view one click away, and the project's scripts, each launched
 * and followed into a browser tab in one click.
 *
 * The scripts come from the launcher plugin's own command: the home does
 * not read package.json itself, and shows nothing when that plugin is off.
 */
export function ToolingHome({ tooling, projectRoot }: ToolingHomeProps) {
  const { t } = useTranslate();
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const launcher = tooling.views.some((view) => view.pluginId === 'project-launcher');
  const browser = tooling.views.some((view) => view.pluginId === 'browser');

  useEffect(() => {
    if (!projectRoot || !launcher) {
      setScripts([]);
      return;
    }
    let cancelled = false;
    void window.bonaparte
      .invokePlugin('project-launcher', 'scripts', { projectRoot })
      .then((reply) => {
        if (!cancelled) setScripts((reply as { scripts?: ScriptEntry[] }).scripts ?? []);
      })
      .catch(() => {
        if (!cancelled) setScripts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, launcher]);

  const runAndFollow = async (script: string): Promise<void> => {
    if (!projectRoot) return;
    await window.bonaparte.invokePlugin('project-launcher', 'run', { projectRoot, script });
    // The browser tab follows the script: it opens the page as soon as the
    // server announces its address. Without a browser, the launcher shows it.
    if (!tooling.openView('browser', 'page', { followScript: script })) {
      tooling.openView('project-launcher', 'launcher');
    }
  };

  return (
    <div className="tooling-home flex flex-col gap-3.5 p-0.5 pb-1.5">
      <p className="tooling-home-hint text-[12.5px] leading-normal text-muted-foreground">
        {t.tooling.homeHint}
      </p>
      <div className="tooling-home-views grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {tooling.views.map((view) => (
          <Button
            key={view.pluginId + ':' + view.viewId}
            type="button"
            variant="secondary"
            className="tooling-home-view h-auto min-h-10 justify-start gap-2 font-normal"
            onClick={() => tooling.open(view)}
          >
            <span className="tooling-home-view-icon text-sm opacity-80" aria-hidden="true">
              {view.icon ?? '▫'}
            </span>
            <span className="tooling-home-view-title min-w-0 flex-1 truncate text-start">{view.title}</span>
            {view.shortcut && <Kbd>{view.shortcut}</Kbd>}
          </Button>
        ))}
      </div>

      {scripts.length > 0 && (
        <section className="tooling-home-scripts">
          <p className="tooling-home-section mb-2 font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
            {t.tooling.homeScripts}
          </p>
          <ul className="tooling-home-script-list flex flex-col gap-1.5">
            {scripts.map((script) => (
              <li key={script.name} className="flex min-w-0 items-center gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`tooling-home-script ${SOFT_PRIMARY}`}
                  onClick={() => void runAndFollow(script.name)}
                  title={script.command}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  {script.name}
                </Button>
                <span className="tooling-home-script-hint truncate text-[11.5px] text-muted-foreground">
                  {browser ? t.tooling.homeRunOpen : t.tooling.homeRun}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
