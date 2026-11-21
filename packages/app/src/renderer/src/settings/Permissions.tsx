/**
 * « Réglages · Permissions » (board): the mode a conversation without a
 * project starts in; what is always asked, whatever the mode — the files
 * that run later, and the ones the person adds —; what leaves the machine;
 * what « Toujours » remembered for the whole app (audit D3); the projects,
 * each with its own rules (« Ouvrir » goes to its page).
 */

import { projectsList, type PlayMode, type ProjectView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { RememberedRules } from './RememberedRules';
import { AlwaysAsked, ModeCards } from './rules';
import { Row, Section, Switch } from './controls';
import type { PageProps } from './SettingsView';

export function PermissionsPage({ messages, values, change, onProject }: PageProps & { onProject(id: string): void }) {
  const words = messages.settings.permissions;
  const [projects, setProjects] = useState<ProjectView[]>([]);
  useEffect(() => {
    void bridge.invoke(projectsList, undefined).then(setProjects).catch(() => undefined);
  }, []);
  const asked = Array.isArray(values['alwaysAsk']) ? (values['alwaysAsk'] as string[]) : [];
  return (
    <div className="settings__sections">
      <p className="settings__intro">{words.intro}</p>
      <Section title={words.defaultMode}>
        <ModeCards
          messages={messages}
          label={words.defaultMode}
          name="default-mode"
          value={(values['defaultMode'] as PlayMode | undefined) ?? 'repetition'}
          onChange={(mode) => change('defaultMode', mode)}
        />
      </Section>
      <Section title={words.alwaysAsk} hint={words.alwaysAskHint}>
        <AlwaysAsked messages={messages} builtins={words.builtins} added={asked} onChange={(next) => change('alwaysAsk', next)} />
      </Section>
      <Section title={words.network} hint={words.networkHint}>
        <Switch label={words.networkAsk} checked={values['askBeforeNetwork'] !== false} onChange={(next) => change('askBeforeNetwork', next)} />
      </Section>
      <Section title={words.remembered.title} hint={words.remembered.hint}>
        <RememberedRules messages={messages} projectId={null} />
      </Section>
      <Section title={words.byProject}>
        {projects.map((project) => (
          <Row
            key={project.id}
            label={project.name}
            hint={messages.modes[project.defaultMode]}
            control={
              <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" aria-label={words.openProject(project.name)} onClick={() => onProject(project.id)}>
                {words.open}
              </button>
            }
          />
        ))}
        <Row label={words.noProject} hint={words.noProjectHint} control={null} />
      </Section>
    </div>
  );
}
