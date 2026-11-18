/**
 * A project's plugins and MCP servers (task 11.3, board « Projet », and the deferral of 10.5): what it uses — the
 * servers of the whole app and its own, the plugins —, and a switch per plugin for this project only: a project
 * switches off what the app runs, never the other way round.
 */

import { localize, mcpOverview, pluginsOverview, pluginsSetEnabled, type Locale, type McpServerViewData, type PluginStatus } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Section } from './controls';

export function ProjectExtensions({ messages, locale, projectId }: { messages: Messages; locale: Locale; projectId: string }) {
  const words = messages.settings.project.extensions;
  const [servers, setServers] = useState<McpServerViewData[]>([]);
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);

  useEffect(() => {
    void bridge
      .invoke(mcpOverview, undefined)
      .then((all) => setServers(all.filter((server) => server.scope.kind === 'app' || server.scope.projectId === projectId)))
      .catch(() => undefined);
    void bridge
      .invoke(pluginsOverview, { projectId })
      .then((found) => setPlugins(found as PluginStatus[]))
      .catch(() => undefined);
  }, [projectId]);

  // What the app itself runs: a plugin switched off for the whole app is not this project's to switch on.
  const shown = plugins.filter((plugin) => plugin.active || !plugin.enabled);
  return (
    <Section title={words.title}>
      <p className="setting-section__hint">{words.uses(servers.length, shown.filter((plugin) => plugin.enabled).length)}</p>
      <h3 className="plugins-section__title">{words.servers}</h3>
      {servers.length === 0 ? (
        <p className="setting-section__hint">{words.none}</p>
      ) : (
        <ul className="plugins-list" aria-label={words.servers}>
          {servers.map((server) => (
            <li key={server.id} className="plugin-row project-server">
              <span className="plugin-row__body">
                <span className="plugin-row__title">
                  <span className="plugin-row__name">{server.id}</span>
                  {server.scope.kind === 'app' ? <span className="aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm">{words.appWide}</span> : null}
                </span>
                <span className="plugin-row__meta">{server.target}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="plugins-section__title">{words.plugins}</h3>
      <ul className="plugins-list" aria-label={words.plugins}>
        {shown.map((plugin) => {
          const name = localize(plugin.name, locale);
          return (
            <li key={plugin.id} className="plugin-row" data-plugin={plugin.id}>
              <span className="plugin-row__body">
                <span className="plugin-row__name">{name}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="aparte-switch aparte-switch--primary"
                aria-label={name}
                checked={plugin.enabled}
                onChange={(event) =>
                  void bridge
                    .invoke(pluginsSetEnabled, { id: plugin.id, enabled: event.target.checked, projectId })
                    .then((next) => setPlugins(next as PluginStatus[]))
                }
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
