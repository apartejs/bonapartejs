/**
 * « Réglages · Général » (board): the language; starting and closing; how
 * the conversations go; the notifications; your data — open its folder,
 * export the conversations as Markdown. The language changes the interface
 * at once, and the replies from the next message on (a note to the model).
 */

import { appOpenDataFolder, conversationsExport } from '@aparte/bonaparte-shared';
import { useState } from 'react';
import { bridge } from '../bridge';
import { Choice, Row, Section, Switch } from './controls';
import { RestartCard, useRestartAsk } from './RestartAsk';
import type { PageProps } from './SettingsView';

/** Said on the window when the language changed: the page asks the main process its words again. */
export const LOCALE_CHANGED = 'bonaparte-locale';

type Notify = 'banner' | 'badge' | 'off';

export function GeneralPage({ messages, locale, values, change }: PageProps) {
  const words = messages.settings.general;
  const [exported, setExported] = useState<string | null>(null);
  // The sub-agents in parallel restart the engine (task 8.3): said first, kept only on a choice.
  const restart = useRestartAsk(() => undefined);
  const subagentsKept = values['subagentsOnBuiltin'] === 'parallel' ? 'parallel' : 'sequential';
  const asked = restart.asking && 'subagents' in restart.asking.change ? restart.asking.change.subagents : null;
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
        <Row
          label={words.subagents}
          hint={words.subagentsHint}
          control={
            <Choice
              small
              label={words.subagents}
              value={asked ?? subagentsKept}
              options={[
                { value: 'sequential', label: words.subagentsSequential },
                { value: 'parallel', label: words.subagentsParallel },
              ]}
              onChange={(next) => restart.ask(next === subagentsKept ? null : { subagents: next })}
            />
          }
        />
        <RestartCard messages={messages} locale={locale} {...restart} />
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
