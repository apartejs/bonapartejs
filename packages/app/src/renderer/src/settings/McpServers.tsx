/**
 * Réglages · Serveurs MCP (task 10.5, board « Réglages · Serveurs MCP »): the servers the core keeps — their
 * scope, their command or address (never their headers), their state named, their tools split as the server
 * says them — filtered, started, stopped, removed; a configuration pasted, a server added by its name and its
 * address or command, for the app or one project. aparté's kit draws it: fields, a segmented choice, badges,
 * tags, buttons and the native dialog.
 */

import {
  mcpAdd,
  mcpOverview,
  mcpPaste,
  mcpRemove,
  mcpStart,
  mcpStop,
  projectsList,
  type McpServerViewData,
  type ProjectView,
} from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Glyph, Icon } from '../shell/icons';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

type Filter = 'all' | 'connected' | 'stopped' | 'failed';
const SHOWN_CHIPS = 7;

const isStopped = (server: McpServerViewData): boolean => server.state === 'stopped' || server.state === 'off';

function Chips({ names, more }: { names: readonly string[]; more(count: number): string }) {
  return (
    <ul className="mcp-server__chips">
      {names.slice(0, SHOWN_CHIPS).map((name) => (
        <li key={name} className="aparte-tag mcp-server__chip">
          <code>{name}</code>
        </li>
      ))}
      {names.length > SHOWN_CHIPS ? <li className="aparte-tag mcp-server__chip">{more(names.length - SHOWN_CHIPS)}</li> : null}
    </ul>
  );
}

export function McpServersPage({ messages }: { messages: Messages }) {
  const words = messages.settings.mcp;
  const [servers, setServers] = useState<McpServerViewData[] | null>(null);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'paste' | 'add' | null>(null);

  const read = (): void => {
    void bridge.invoke(mcpOverview, undefined).then(setServers).catch(() => setServers([]));
  };
  useEffect(() => {
    read();
    void bridge.invoke(projectsList, undefined).then(setProjects).catch(() => undefined);
  }, []);
  // A server connecting is read again until it says how it went.
  useEffect(() => {
    if (!servers?.some((server) => server.state === 'connecting')) return;
    const timer = setTimeout(read, 500);
    return () => clearTimeout(timer);
  }, [servers]);

  const act = async (id: string, channel: typeof mcpStart | typeof mcpStop | typeof mcpRemove): Promise<void> => {
    setBusy(id);
    try {
      setServers(await bridge.invoke(channel, { id }));
    } finally {
      setBusy(null);
    }
  };

  const all = servers ?? [];
  const counts = {
    all: all.length,
    connected: all.filter((server) => server.state === 'connected').length,
    stopped: all.filter(isStopped).length,
    failed: all.filter((server) => server.state === 'failed').length,
  };
  const needle = query.trim().toLowerCase();
  const shown = all.filter((server) => {
    if (filter === 'connected' && server.state !== 'connected') return false;
    if (filter === 'stopped' && !isStopped(server)) return false;
    if (filter === 'failed' && server.state !== 'failed') return false;
    if (!needle) return true;
    return server.id.toLowerCase().includes(needle) || server.tools.some((tool) => tool.name.toLowerCase().includes(needle));
  });
  const projectName = (id: string): string => projects.find((project) => project.id === id)?.name ?? id;

  return (
    <div className="settings__sections settings__sections--wide mcp-page">
      <div className="mcp-page__head">
        <p className="settings__intro">{words.intro}</p>
        <div className="setting-actions">
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => setDialog('paste')}>
            {words.paste}
          </button>
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => setDialog('add')}>
            <Icon name="plus" />
            {words.add}
          </button>
        </div>
      </div>

      <div className="mcp-page__filters">
        <input
          type="search"
          className="aparte-field mcp-page__search"
          placeholder={words.filter}
          aria-label={words.filter}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div role="radiogroup" aria-label={words.show} className="aparte-segmented">
          {(['all', 'connected', 'stopped', 'failed'] as const).map((one) => (
            <label key={one} className="aparte-segmented__item">
              <input type="radio" name="mcp-filter" checked={filter === one} onChange={() => setFilter(one)} />
              <span>{words.tabs[one](counts[one])}</span>
            </label>
          ))}
        </div>
      </div>

      {servers === null ? null : all.length === 0 ? (
        <p className="setting-section__hint">{words.empty}</p>
      ) : shown.length === 0 ? (
        <p className="setting-section__hint">{words.none}</p>
      ) : (
        <ul className="mcp-list" aria-label={messages.settings.pages.mcp}>
          {shown.map((server) => {
            const expanded = open.has(server.id);
            const readOnly = server.tools.filter((tool) => tool.readOnly).map((tool) => tool.name);
            const writes = server.tools.filter((tool) => !tool.readOnly).map((tool) => tool.name);
            const action =
              server.state === 'connected' ? words.restart : server.state === 'failed' ? words.reconnect : server.state === 'connecting' ? null : words.start;
            return (
              <li key={server.id} className="mcp-server" data-state={server.state}>
                <div className="mcp-server__row">
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--sm aparte-btn--ghost aparte-btn--icon mcp-server__toggle"
                    aria-expanded={expanded}
                    aria-label={expanded ? words.collapse(server.id) : words.expand(server.id)}
                    onClick={() =>
                      setOpen((was) => {
                        const next = new Set(was);
                        if (next.has(server.id)) next.delete(server.id);
                        else next.add(server.id);
                        return next;
                      })
                    }
                  >
                    <Glyph name={expanded ? 'collapse' : 'expand'} />
                  </button>
                  <span className={`mcp-server__dot mcp-server__dot--${server.state}`} role="img" aria-label={words.state[server.state]} />
                  <span className="mcp-server__name">
                    <strong>{server.id}</strong>
                    <span className="aparte-tag mcp-server__scope">
                      {server.scope.kind === 'project' ? words.project(projectName(server.scope.projectId)) : words.app}
                    </span>
                  </span>
                  <code className="mcp-server__target" title={server.target}>
                    {server.target}
                  </code>
                  {server.state === 'connected' ? <span className="mcp-server__count">{words.tools(server.tools.length)}</span> : null}
                  {action ? (
                    <button
                      type="button"
                      className="aparte-btn aparte-btn--sm aparte-btn--outline"
                      disabled={busy === server.id}
                      aria-busy={busy === server.id || undefined}
                      onClick={() => void act(server.id, mcpStart)}
                    >
                      {action}
                    </button>
                  ) : (
                    <span className="aparte-spinner aparte-spinner--sm" aria-hidden="true" />
                  )}
                </div>
                {server.state === 'failed' && server.error ? (
                  <p className="mcp-server__line mcp-server__line--failed">{words.refused(server.error.split('\n')[0] ?? server.error)}</p>
                ) : null}
                {server.state === 'stopped' ? <p className="mcp-server__line">{words.stoppedLine}</p> : null}
                {server.state === 'off' ? <p className="mcp-server__line">{words.offLine}</p> : null}
                {expanded ? (
                  <div className="mcp-server__panel">
                    {readOnly.length > 0 ? (
                      <section>
                        <h3 className="mcp-server__heading">{words.readOnly(readOnly.length)}</h3>
                        <Chips names={readOnly} more={words.more} />
                      </section>
                    ) : null}
                    {writes.length > 0 ? (
                      <section>
                        <h3 className="mcp-server__heading">{words.writes(writes.length)}</h3>
                        <Chips names={writes} more={words.more} />
                      </section>
                    ) : null}
                    {server.tools.length > 0 ? <p className="setting-section__hint">{words.hint}</p> : null}
                    <div className="setting-actions">
                      {server.state === 'connected' ? (
                        <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--outline" onClick={() => void act(server.id, mcpStop)}>
                          {words.stop}
                        </button>
                      ) : null}
                      <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--ghost" onClick={() => void act(server.id, mcpRemove)}>
                        {words.remove}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <PasteDialog
        open={dialog === 'paste'}
        messages={messages}
        onClose={() => setDialog(null)}
        onDone={() => {
          read();
        }}
      />
      <AddDialog
        open={dialog === 'add'}
        messages={messages}
        projects={projects}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          read();
        }}
      />
    </div>
  );
}

function useModal(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return dialog;
}

function PasteDialog({ open, messages, onClose, onDone }: { open: boolean; messages: Messages; onClose(): void; onDone(): void }) {
  const words = messages.settings.mcp.pasteDialog;
  const dialog = useModal(open);
  const titleId = useId();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setSaid(null);
    }
  }, [open]);
  const submit = async (): Promise<void> => {
    const result = await bridge.invoke(mcpPaste, { text });
    if (!result.ok) {
      setSaid(words.unreadable);
      return;
    }
    if (result.added.length === 0 && result.errors.some((error) => error.code === 'object' && error.id === '')) {
      setSaid(words.notJson);
      return;
    }
    const broken = result.errors.map((error) => error.id).filter(Boolean);
    setSaid([words.added(result.added.length), broken.length > 0 ? words.broken(broken.join(', ')) : ''].filter(Boolean).join(' '));
    onDone();
  };
  return (
    <dialog ref={dialog} className="aparte-dialog mcp-dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        <label className="aparte-field-label" htmlFor={fieldId}>
          {words.label}
        </label>
        <textarea
          id={fieldId}
          className="aparte-field mcp-dialog__text"
          rows={8}
          placeholder={words.placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {said ? (
          <p className="aparte-field-hint" role="status">
            {said}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--outline" onClick={onClose}>
          {words.cancel}
        </button>
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" disabled={text.trim() === ''} onClick={() => void submit()}>
          {words.submit}
        </button>
      </footer>
    </dialog>
  );
}

function AddDialog({
  open,
  messages,
  projects,
  onClose,
  onDone,
}: {
  open: boolean;
  messages: Messages;
  projects: readonly ProjectView[];
  onClose(): void;
  onDone(): void;
}) {
  const words = messages.settings.mcp.addDialog;
  const dialog = useModal(open);
  const titleId = useId();
  const nameId = useId();
  const targetId = useId();
  const scopeId = useId();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState('');
  const [error, setError] = useState<keyof typeof words.errors | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setTarget('');
      setScope('');
      setError(null);
    }
  }, [open]);
  const submit = async (): Promise<void> => {
    const result = await bridge.invoke(mcpAdd, { name, target, ...(scope ? { projectId: scope } : {}) });
    if (result.ok) onDone();
    else setError(result.error);
  };
  return (
    <dialog ref={dialog} className="aparte-dialog mcp-dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
      </header>
      <div className="aparte-dialog__body mcp-dialog__fields">
        <div className="mcp-dialog__field">
          <label className="aparte-field-label" htmlFor={nameId}>
            {words.name}
          </label>
          <input id={nameId} className="aparte-field" value={name} onChange={(event) => setName(event.target.value)} />
          <span className="aparte-field-hint">{words.nameHint}</span>
        </div>
        <div className="mcp-dialog__field">
          <label className="aparte-field-label" htmlFor={targetId}>
            {words.target}
          </label>
          <input id={targetId} className="aparte-field" value={target} onChange={(event) => setTarget(event.target.value)} />
          <span className="aparte-field-hint">{words.targetHint}</span>
        </div>
        <div className="mcp-dialog__field">
          <label className="aparte-field-label" htmlFor={scopeId}>
            {words.scope}
          </label>
          <select id={scopeId} className="aparte-field" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">{messages.settings.mcp.app}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {messages.settings.mcp.project(project.name)}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="aparte-field-warning" role="alert">
            {words.errors[error]}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--outline" onClick={onClose}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={name.trim() === '' || target.trim() === ''}
          onClick={() => void submit()}
        >
          {words.submit}
        </button>
      </footer>
    </dialog>
  );
}
