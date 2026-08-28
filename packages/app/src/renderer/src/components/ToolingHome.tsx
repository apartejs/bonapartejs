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
    <div className="tooling-home">
      <p className="tooling-home-hint">{t.tooling.homeHint}</p>
      <div className="tooling-home-views">
        {tooling.views.map((view) => (
          <button
            key={view.pluginId + ':' + view.viewId}
            type="button"
            className="tooling-home-view aparte-btn aparte-btn--neutral aparte-btn--soft"
            onClick={() => tooling.open(view)}
          >
            <span className="tooling-home-view-icon" aria-hidden="true">
              {view.icon ?? '▫'}
            </span>
            <span className="tooling-home-view-title">{view.title}</span>
            {view.shortcut && <kbd className="aparte-kbd">{view.shortcut}</kbd>}
          </button>
        ))}
      </div>

      {scripts.length > 0 && (
        <section className="tooling-home-scripts">
          <p className="tooling-home-section">{t.tooling.homeScripts}</p>
          <ul className="tooling-home-script-list">
            {scripts.map((script) => (
              <li key={script.name}>
                <button
                  type="button"
                  className="tooling-home-script aparte-btn aparte-btn--primary aparte-btn--soft aparte-btn--sm"
                  onClick={() => void runAndFollow(script.name)}
                  title={script.command}
                >
                  <span aria-hidden="true">▶</span> {script.name}
                </button>
                <span className="tooling-home-script-hint">
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
