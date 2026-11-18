/**
 * The browser's new tab (task 10.3, board « Le navigateur et ses outils »): what the project of the conversation
 * shown can run — the scripts of its package.json that serve a page, the services of its compose file — with
 * « Tout lancer », « Lancer et ouvrir » or « Ouvrir », and the servers already running on this machine. A launch
 * is the core's (hidden, an argument array, never a shell); its output shows in the terminal; the page opens
 * here once the server answers.
 */

import { runsList, runsStart, runsStop, type RunViewData } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

export interface RunScope {
  conversationId?: string;
  projectId?: string;
}

/** A script that serves a page (dev, start, serve, preview, storybook…); the others belong to the terminal. */
const SERVES = /^(?:dev|start|serve|preview|storybook|watch)(?:[:._-].*)?$|[:._-](?:dev|start|serve|preview)$/i;
const READ_EVERY_MS = 500;
const OPEN_WITHIN_MS = 60_000;

export interface NewTabProps {
  messages: Messages;
  scope: RunScope;
  /** Opens an address in the tab. */
  onOpen(url: string): void;
}

export function NewTab({ messages, scope, onOpen }: NewTabProps) {
  const words = messages.browser.runs;
  const [project, setProject] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunViewData[] | null>(null);
  const [elsewhere, setElsewhere] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const live = useRef(true);
  const key = JSON.stringify(scope);

  const read = async (): Promise<RunViewData[]> => {
    const listed = await bridge.invoke(runsList, scope);
    if (!live.current) return listed.runs;
    setProject(listed.projectName);
    setRuns(listed.runs.filter((run) => run.kind === 'service' || SERVES.test(run.name)));
    setElsewhere(listed.alreadyRunning.filter((url) => !listed.runs.some((run) => run.url && new URL(run.url).port === new URL(url).port)));
    return listed.runs;
  };

  useEffect(() => {
    live.current = true;
    void read();
    const timer = setInterval(() => void read(), 2_000);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [key]);

  /** Starts it (unless it runs), then opens its page once it answers. */
  const launchAndOpen = async (run: RunViewData): Promise<void> => {
    setWaiting((was) => new Set(was).add(run.name));
    try {
      if (run.state !== 'running') await bridge.invoke(runsStart, { ...scope, kind: run.kind, name: run.name });
      const deadline = Date.now() + OPEN_WITHIN_MS;
      while (live.current && Date.now() < deadline) {
        const now = (await read()).find((one) => one.kind === run.kind && one.name === run.name);
        if (!now || now.state === 'exited') return;
        if (now.url && now.ready) {
          onOpen(now.url);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, READ_EVERY_MS));
      }
    } finally {
      setWaiting((was) => {
        const next = new Set(was);
        next.delete(run.name);
        return next;
      });
    }
  };

  const startAll = async (): Promise<void> => {
    for (const run of runs ?? []) if (run.state !== 'running') await bridge.invoke(runsStart, { ...scope, kind: run.kind, name: run.name });
    await read();
  };

  return (
    <div className="new-tab">
      <div className="new-tab__head">
        <div>
          <h2 className="browser-pane__empty-title">{messages.browser.newTab}</h2>
          <p className="aparte-field-hint">{project ? words.intro(project) : words.noProject}</p>
        </div>
        {runs && runs.length > 0 ? (
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => void startAll()}>
            {words.runAll}
          </button>
        ) : null}
      </div>

      {project && runs ? (
        runs.length === 0 ? (
          <p className="aparte-field-hint">{words.nothing}</p>
        ) : (
          <section aria-label={words.inProject} className="new-tab__list">
            {runs.map((run) => {
              const busy = waiting.has(run.name);
              const state = run.state === 'running' ? words.running : run.state === 'exited' ? words.exited : words.stopped;
              return (
                <div key={`${run.kind}:${run.name}`} className="new-tab__row" data-run={run.name}>
                  <span className="new-tab__icon" aria-hidden="true">
                    <Icon name="terminal" />
                  </span>
                  <span className="new-tab__what">
                    <code>{run.command}</code>
                    {run.url ? <span className="aparte-field-hint">{run.url}</span> : null}
                  </span>
                  <span className={`aparte-badge ${run.state === 'running' ? 'aparte-badge--success' : 'aparte-badge--neutral'}`}>{busy ? words.starting : state}</span>
                  {run.state === 'running' ? (
                    <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--ghost" onClick={() => void bridge.invoke(runsStop, { ...scope, name: run.name }).then(read)}>
                      {words.stop}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`aparte-btn aparte-btn--sm ${run.state === 'running' ? 'aparte-btn--outline' : 'aparte-btn--primary aparte-btn--solid'}`}
                    disabled={busy}
                    aria-busy={busy || undefined}
                    onClick={() => (run.state === 'running' && run.url ? onOpen(run.url) : void launchAndOpen(run))}
                  >
                    {run.state === 'running' && run.url ? words.open : words.launchOpen}
                  </button>
                </div>
              );
            })}
          </section>
        )
      ) : null}

      {elsewhere.length > 0 ? (
        <section aria-label={words.elsewhere} className="new-tab__elsewhere">
          <h3 className="new-tab__heading">{words.elsewhere}</h3>
          {elsewhere.map((url) => (
            <div key={url} className="new-tab__row">
              <span className="new-tab__what">
                <code>{url.replace(/^http:\/\//, '').replace(/\/$/, '')}</code>
                <span className="aparte-field-hint">{words.outside}</span>
              </span>
              <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--outline" onClick={() => onOpen(url)}>
                {words.open}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {project ? <p className="aparte-field-hint new-tab__footnote">{words.footnote}</p> : null}
    </div>
  );
}
