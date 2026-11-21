/**
 * « Réglages · Général » (board): the language; starting and closing; how
 * the conversations go; the notifications; your data — open its folder,
 * export the conversations as Markdown. The language changes the interface
 * at once, and the replies from the next message on (a note to the model).
 */

import { appOpenDataFolder, conversationsExport, providersList, providersModels } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { Choice, Row, Section, Switch } from './controls';
import type { PageProps } from './SettingsView';

/** Said on the window when the language changed: the page asks the main process its words again. */
export const LOCALE_CHANGED = 'bonaparte-locale';

type Notify = 'banner' | 'badge' | 'off';

export function GeneralPage({ messages, locale, values, change }: PageProps) {
  const words = messages.settings.general;
  const [exported, setExported] = useState<string | null>(null);
  const language = values['language'] === 'fr' || values['language'] === 'en' ? values['language'] : locale;
  const notify = (key: string, label: string) => (
    <Row
      key={key}
      label={label}
      control={
        <Choice<Notify>
          small
          label={label}
          value={(values[key] as Notify | undefined) ?? 'banner'}
          options={[
            { value: 'banner', label: words.banner },
            { value: 'badge', label: words.badge },
            { value: 'off', label: words.off },
          ]}
          onChange={(next) => change(key, next)}
        />
      }
    />
  );
  return (
    <div className="settings__sections">
      <Section title={words.language} single>
        <Row
          label={words.language}
          hint={words.languageHint}
          control={
            <Choice
              label={words.language}
              value={language}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(next) => {
                change('language', next);
                // After the core kept it: the main process answers in the new language.
                setTimeout(() => window.dispatchEvent(new CustomEvent(LOCALE_CHANGED)), 50);
              }}
            />
          }
        />
      </Section>
      <Section title={words.startup}>
        <Switch label={words.launchAtLogin} hint={words.launchAtLoginHint} checked={values['launchAtLogin'] === true} onChange={(next) => change('launchAtLogin', next)} />
        <Switch label={words.closeToTray} hint={words.closeToTrayHint} checked={values['closeToTray'] !== false} onChange={(next) => change('closeToTray', next)} />
        <Switch label={words.reopenLast} checked={values['reopenLast'] !== false} onChange={(next) => change('reopenLast', next)} />
      </Section>
      <Section title={words.conversations}>
        <Row
          label={words.sidebar}
          hint={words.sidebarHint}
          control={
            <Choice
              small
              label={words.sidebar}
              value={values['sidebarGrouping'] === 'single' ? 'single' : 'project'}
              options={[
                { value: 'project', label: words.sidebarProject },
                { value: 'single', label: words.sidebarSingle },
              ]}
              onChange={(next) => change('sidebarGrouping', next)}
            />
          }
        />
        <Row
          label={words.autoOpen}
          hint={words.autoOpenHint}
          control={
            <Choice
              small
              label={words.autoOpen}
              value={(values['autoOpenPanel'] as 'never' | 'approval' | 'always' | undefined) ?? 'approval'}
              options={[
                { value: 'never', label: words.autoOpenNever },
                { value: 'approval', label: words.autoOpenApproval },
                { value: 'always', label: words.autoOpenAlways },
              ]}
              onChange={(next) => change('autoOpenPanel', next)}
            />
          }
        />
        <Row
          label={words.worksIn}
          hint={words.worksInHint}
          control={
            <Choice
              small
              label={words.worksIn}
              value={values['newConversationWorksIn'] === 'branch' ? 'branch' : 'folder'}
              options={[
                { value: 'folder', label: words.worksInFolder },
                { value: 'branch', label: words.worksInBranch },
              ]}
              onChange={(next) => change('newConversationWorksIn', next)}
            />
          }
        />
        <SubagentsEngine words={words} value={typeof values['subagentsEngine'] === 'string' ? values['subagentsEngine'] : 'conversation'} change={(next) => change('subagentsEngine', next)} />
      </Section>
      <Section title={words.notifications} hint={words.notificationsHint}>
        {notify('notifications.replyDone', words.notifyReplyDone)}
        {notify('notifications.approval', words.notifyApproval)}
        {notify('notifications.question', words.notifyQuestion)}
        {notify('notifications.failure', words.notifyFailure)}
      </Section>
      <Section title={words.data}>
        <p className="setting-section__hint">{words.dataHint}</p>
        <div className="setting-actions">
          <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => void bridge.invoke(appOpenDataFolder, undefined).catch(() => undefined)}>
            {words.openFolder}
          </button>
          <button
            type="button"
            className="aparte-btn aparte-btn--outline"
            onClick={() => {
              setExported(null);
              bridge
                .invoke(conversationsExport, { labels: words.exportLabels })
                .then((done) => {
                  if (done) setExported(words.exported(done.count, done.folder));
                })
                .catch(() => setExported(words.exportFailed));
            }}
          >
            {words.export}
          </button>
        </div>
        {exported ? (
          <p className="setting-section__hint" role="status">
            {exported}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/** A service the person added, and the models it offers now. */
interface Service {
  id: string;
  label: string;
  models: string[];
}

/** The services added, each asked its models; empty while they are read, or when none is added. */
function useServices(): Service[] {
  const [services, setServices] = useState<Service[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await bridge.invoke(providersList, undefined).catch(() => []);
      const found = await Promise.all(
        all
          .filter((provider) => provider.kind === 'openai-compat')
          .map(async (provider) => ({ id: provider.id, label: provider.label, models: await bridge.invoke(providersModels, { id: provider.id }).catch(() => [] as string[]) })),
      );
      if (live) setServices(found);
    })();
    return () => {
      live = false;
    };
  }, []);
  return services;
}

/**
 * « Moteur des sous-agents » (audit S1): the conversation's engine, or a service the person added and one of its
 * models (`<service id>/<model>`). What leaves for the service is said before it is chosen, under the row.
 */
function SubagentsEngine({ words, value, change }: { words: PageProps['messages']['settings']['general']; value: string; change(next: string): void }) {
  const services = useServices();
  const listed = services.flatMap((service) => service.models.map((model) => `${service.id}/${model}`));
  // A choice kept whose service does not answer now: still shown as it is, never replaced in silence.
  const kept = value !== 'conversation' && !listed.includes(value) ? value : null;
  const labelOf = (id: string): string => services.find((service) => service.id === id)?.label ?? id;
  return (
    <Row
      label={words.subagentsEngine}
      hint={services.length > 0 ? words.subagentsEngineHint : words.subagentsEngineNone}
      control={
        <select className="aparte-field subagents-engine" aria-label={words.subagentsEngine} value={value} onChange={(event) => change(event.target.value)}>
          <option value="conversation">{words.subagentsEngineConversation}</option>
          {services
            .filter((service) => service.models.length > 0)
            .map((service) => (
              <optgroup key={service.id} label={service.label}>
                {service.models.map((model) => (
                  <option key={model} value={`${service.id}/${model}`}>
                    {words.subagentsEngineOption(model, service.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          {kept ? <option value={kept}>{words.subagentsEngineOption(kept.slice(kept.indexOf('/') + 1), labelOf(kept.slice(0, kept.indexOf('/'))))}</option> : null}
        </select>
      }
    />
  );
}
