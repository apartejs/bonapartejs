/**
 * Réglages · Plugins (task 11.3, board « Réglages · Plugins »): the plugins added and the built-in ones — each with
 * its scope, its effects, where it came from, a switch —, filtered and counted (« Tous », « Activés », « Coupés »);
 * « Ajouter… » reads one before anything of it runs; « Créer avec l’agent » starts a conversation that asks for
 * one. Switching a plugin off takes away all it added. aparté's kit draws it: fields, a segmented choice, badges,
 * switches and buttons; the rows are ours, on its tokens.
 */

import { extensionsStop, localize, pluginsCheckUpdates, pluginsOverview, pluginsRemove, pluginsSetEnabled, type Locale, type PluginStatus } from '@aparte/bonaparte-shared';
import { useEffect, useId, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { AddPluginDialog } from '../dialogs/AddPlugin';
import { Icon, type IconName } from '../shell/icons';
import { WebSearchDialog } from './WebSearch';

type Filter = 'all' | 'on' | 'off';
type Effect = 'read' | 'write' | 'execute' | 'network';

const EFFECT_STYLE: Record<Effect, string> = {
  read: 'aparte-badge--neutral',
  write: 'aparte-badge--warning',
  execute: 'aparte-badge--danger',
  network: 'aparte-badge--info',
};

/** Where a plugin added came from, in the person's words. */
function sourceLine(plugin: PluginStatus, words: Messages['plugins']): string | null {
  const source = plugin.source as
    | { kind: 'folder'; path: string }
    | { kind: 'npm'; name: string; version: string }
    | { kind: 'git'; url: string; ref: string }
    | { kind: 'conversation'; title?: string }
    | undefined;
  if (!source) return null;
  if (source.kind === 'folder') return `${words.from.folder} · ${source.path} · ${plugin.version}`;
  if (source.kind === 'npm') return `${words.from.npm} · ${source.name} · ${source.version}`;
  if (source.kind === 'git') return `${words.from.git} · ${source.url} · ${source.ref}`;
  return words.from.conversation(source.title ?? '');
}

export interface PluginsPageProps {
  messages: Messages;
  locale: Locale;
  /** « Créer avec l’agent »: a new conversation, its composer asking for a plugin. */
  onCreate(): void;
  /** « Ouvrir la conversation »: the conversation a plugin was made in. */
  onOpenConversation?(id: string): void;
}

/** Each row's icon: what a built-in does, where an added one came from. */
const BUILTIN_ICONS: Record<string, IconName> = {
  terminal: 'terminal',
  browser: 'globe',
  'web-search': 'search',
  subagents: 'subagents',
  'project-scripts': 'terminal',
  'auto-titles': 'edit',
  'conversation-plugins': 'conversation',
};
function iconOf(plugin: PluginStatus, conversation: string | null): IconName {
  if (plugin.builtin) return BUILTIN_ICONS[plugin.id] ?? 'panel';
  if (conversation !== null) return 'conversation';
  return (plugin.source as { kind?: string } | undefined)?.kind === 'git' ? 'branch' : 'folder';
}

/** The conversation a plugin was made in: the one it is tried in, or the one it was installed from. */
function madeIn(plugin: PluginStatus): string | null {
  if (plugin.trial !== undefined) return plugin.trial;
  const source = plugin.source as { kind: string; conversationId?: string } | undefined;
  return source?.kind === 'conversation' && source.conversationId ? source.conversationId : null;
}

export function PluginsPage({ messages, locale, onCreate, onOpenConversation }: PluginsPageProps) {
  const words = messages.plugins;
  const [plugins, setPlugins] = useState<PluginStatus[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'add' | 'search' | null>(null);
  const madeId = useId();
  const addedId = useId();
  const builtinId = useId();

  const read = (): void => {
    void bridge
      .invoke(pluginsOverview, {})
      .then((found) => setPlugins(found as PluginStatus[]))
      .catch(() => setPlugins([]));
  };
  useEffect(() => {
    read();
    return bridge.on((event) => {
      if (event.kind === 'plugins') read();
    });
  }, []);

  const act = async (id: string, run: () => Promise<unknown>): Promise<void> => {
    setBusy(id);
    try {
      setPlugins((await run()) as PluginStatus[]);
    } finally {
      setBusy(null);
    }
  };

  const all = plugins ?? [];
  const counts = { all: all.length, on: all.filter((plugin) => plugin.enabled).length, off: all.filter((plugin) => !plugin.enabled).length };
  const needle = query.trim().toLowerCase();
  const shown = all.filter((plugin) => {
    if (filter === 'on' && !plugin.enabled) return false;
    if (filter === 'off' && plugin.enabled) return false;
    if (!needle) return true;
    return [plugin.id, localize(plugin.name, locale), plugin.description ? localize(plugin.description, locale) : ''].some((text) => text.toLowerCase().includes(needle));
  });
  const made = shown.filter((plugin) => !plugin.builtin && madeIn(plugin) !== null);
  const added = shown.filter((plugin) => !plugin.builtin && madeIn(plugin) === null);
  const builtin = shown.filter((plugin) => plugin.builtin);

  const rowOf = (plugin: PluginStatus) => {
    const name = localize(plugin.name, locale);
    const trial = plugin.trial !== undefined;
    const source = trial ? words.trialLine : sourceLine(plugin, words);
    const conversation = madeIn(plugin);
    return (
      <li key={plugin.id} className={`plugin-row${trial ? ' plugin-row--trial' : ''}`} data-plugin={plugin.id}>
        <span className="plugin-row__icon" aria-hidden="true">
          <Icon name={iconOf(plugin, conversation)} />
        </span>
        <span className="plugin-row__body">
          <span className="plugin-row__title">
            <span className="plugin-row__name">{name}</span>
            <span className="aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm">{trial ? words.trialScope : words.appScope}</span>
            {trial ? <span className="aparte-badge aparte-badge--neutral aparte-badge--outline aparte-badge--sm">{words.onTrial}</span> : null}
            {plugin.effects.length === 0 ? (
              <span className="aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm">{words.effects.ui}</span>
            ) : (
              [...new Set(plugin.effects.map((one) => one.effect))].map((effect) => (
                <span key={effect} className={`aparte-badge ${EFFECT_STYLE[effect]} aparte-badge--soft aparte-badge--sm`}>
                  {words.effects[effect]}
                </span>
              ))
            )}
          </span>
          {plugin.description ? <span className="plugin-row__description">{localize(plugin.description, locale)}</span> : null}
          {source ? <span className="plugin-row__meta">{source}</span> : null}
          {plugin.update ? <span className="plugin-row__meta">{words.update(plugin.update)}</span> : null}
          {plugin.error ? (
            <span className="aparte-field-warning plugin-row__meta" role="status">
              {words.stopped(plugin.error)}
            </span>
          ) : null}
        </span>
        <span className="plugin-row__actions">
          {plugin.id === 'web-search' ? (
            <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => setDialog('search')}>
              {words.settings}
            </button>
          ) : null}
          {conversation !== null && onOpenConversation ? (
            <button
              type="button"
              className="aparte-btn aparte-btn--ghost aparte-btn--sm"
              aria-label={words.openConversationOf(name)}
              onClick={() => onOpenConversation(conversation)}
            >
              {words.openConversation}
            </button>
          ) : null}
          {trial ? (
            <button
              type="button"
              className="aparte-btn aparte-btn--outline aparte-btn--sm"
              aria-label={words.stopTrialOf(name)}
              disabled={busy === plugin.id}
              onClick={() => void act(plugin.id, () => bridge.invoke(extensionsStop, { id: plugin.id }))}
            >
              {words.stopTrial}
            </button>
          ) : null}
          {!plugin.builtin && !trial ? (
            <button
              type="button"
              className="aparte-btn aparte-btn--ghost aparte-btn--sm"
              disabled={busy === plugin.id}
              onClick={() => void act(plugin.id, () => bridge.invoke(pluginsRemove, { id: plugin.id }))}
            >
              {words.remove(name)}
            </button>
          ) : null}
          {/* A trial is not switched here: « Arrêter l’essai » ends it, as its conversation's model or deletion does. */}
          {trial ? null : (
          <input
            type="checkbox"
            role="switch"
            className="aparte-switch aparte-switch--primary"
            aria-label={words.switchFor(name)}
            checked={plugin.enabled}
            disabled={busy === plugin.id}
            onChange={(event) => void act(plugin.id, () => bridge.invoke(pluginsSetEnabled, { id: plugin.id, enabled: event.target.checked }))}
          />
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="settings__sections settings__sections--wide plugins-page">
      <div className="mcp-page__head">
        <p className="settings__intro">{words.intro}</p>
        <div className="setting-actions">
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => setDialog('add')}>
            {words.add}
          </button>
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onCreate}>
            <Icon name="plus" />
            {words.create}
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
          {(['all', 'on', 'off'] as const).map((one) => (
            <label key={one} className="aparte-segmented__item">
              <input type="radio" name="plugins-filter" checked={filter === one} onChange={() => setFilter(one)} />
              <span>{words.tabs[one](counts[one])}</span>
            </label>
          ))}
        </div>
        <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--sm" onClick={() => void act('', () => bridge.invoke(pluginsCheckUpdates, undefined))}>
          {words.updateCheck}
        </button>
      </div>

      {plugins === null ? null : shown.length === 0 ? (
        <p className="setting-section__hint">{words.none}</p>
      ) : (
        <>
          {made.length > 0 ? (
            <section className="plugins-section" aria-labelledby={madeId}>
              <h2 id={madeId} className="plugins-section__title">
                {words.created}
              </h2>
              <ul className="plugins-list">{made.map(rowOf)}</ul>
            </section>
          ) : null}
          <section className="plugins-section" aria-labelledby={addedId}>
            <h2 id={addedId} className="plugins-section__title">
              {words.added}
            </h2>
            {added.length === 0 ? <p className="setting-section__hint">{words.empty}</p> : <ul className="plugins-list">{added.map(rowOf)}</ul>}
          </section>
          {builtin.length > 0 ? (
            <section className="plugins-section" aria-labelledby={builtinId}>
              <h2 id={builtinId} className="plugins-section__title">
                {words.builtin}
                <span className="plugins-section__hint">{words.builtinHint}</span>
              </h2>
              <ul className="plugins-list plugins-list--joined">{builtin.map(rowOf)}</ul>
            </section>
          ) : null}
        </>
      )}

      <AddPluginDialog open={dialog === 'add'} messages={messages} locale={locale} onClose={() => setDialog(null)} onAdded={(found) => setPlugins(found)} />
      <WebSearchDialog open={dialog === 'search'} messages={messages} onClose={() => setDialog(null)} />
    </div>
  );
}
