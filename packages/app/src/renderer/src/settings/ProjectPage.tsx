/**
 * « Projet » (board): its name; its folders — the root first, the others
 * removable, one added from the system's dialog —; its instructions file;
 * its permissions — the mode its conversations start in, what is always
 * asked there. Reached from « Réglages · Permissions ».
 */

import { projectsAddFolder, projectsDetect, projectsList, projectsUpdate, type Locale, type ProjectView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';
import { Section } from './controls';
import { ProjectExtensions } from './ProjectExtensions';
import { RememberedRules } from './RememberedRules';
import { AlwaysAsked, ModeCards } from './rules';

/** What a project's own list starts from: the files of a project that run later. */
const PROJECT_BUILTINS = ['.env*', 'package.json', '.git/hooks/', '.husky/'];

export function ProjectPage({ messages, locale, projectId }: { messages: Messages; locale: Locale; projectId: string }) {
  const words = messages.settings.project;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [instructions, setInstructions] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void bridge.invoke(projectsList, undefined).then((all) => {
      const found = all.find((one) => one.id === projectId) ?? null;
      setProject(found);
      if (found?.roots[0]) {
        void bridge
          .invoke(projectsDetect, { folder: found.roots[0] })
          .then((facts) => setInstructions(facts.instructions))
          .catch(() => setInstructions(null));
      }
    });
  }, [projectId]);
  if (!project) return null;

  const update = (changes: { roots?: string[]; defaultMode?: ProjectView['defaultMode']; alwaysAsk?: string[] }): void => {
    // Shown at once, then as the core kept it.
    setProject((was) => (was ? { ...was, ...changes } : was));
    void bridge.invoke(projectsUpdate, { id: project.id, changes }).then(setProject).catch(() => undefined);
  };
  return (
    <div className="settings__sections settings__sections--wide">
      <p className="settings__intro">
        <span className="project-badge">{words.badge}</span> {words.intro}
      </p>
      <div className="project-cards">
        <Section title={words.folders}>
          <ul className="project-folders">
            {project.roots.map((root, index) => (
              <li key={root} className="project-folder">
                <Icon name="folder" />
                <code className="project-folder__path">{root}</code>
                {index === 0 ? (
                  <span className="project-folder__root">{words.root}</span>
                ) : (
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--icon aparte-btn--ghost aparte-btn--sm"
                    aria-label={words.removeFolder}
                    title={words.removeFolder}
                    onClick={() => update({ roots: project.roots.filter((one) => one !== root) })}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="setting-actions">
            <button
              type="button"
              className="aparte-btn aparte-btn--outline"
              onClick={() => void bridge.invoke(projectsAddFolder, { id: project.id }).then((next) => next && setProject(next))}
            >
              {words.addFolder}
            </button>
          </div>
        </Section>
        <Section title={words.instructions}>
          <p className="setting-section__hint">{instructions ? words.instructionsFound(instructions) : instructions === null ? words.noInstructions : null}</p>
        </Section>
      </div>
      <Section title={words.permissions}>
        <ModeCards
          messages={messages}
          label={words.projectMode}
          name="project-mode"
          value={project.defaultMode}
          onChange={(defaultMode) => update({ defaultMode })}
        />
        <h3 className="setting-section__subtitle">{words.alwaysAskHere}</h3>
        <AlwaysAsked messages={messages} builtins={PROJECT_BUILTINS} added={project.alwaysAsk ?? []} onChange={(alwaysAsk) => update({ alwaysAsk })} />
        <h3 className="setting-section__subtitle">{messages.settings.permissions.remembered.title}</h3>
        <p className="setting-section__hint">{messages.settings.permissions.remembered.projectHint}</p>
        <RememberedRules messages={messages} projectId={project.id} />
      </Section>
      <ProjectExtensions messages={messages} locale={locale} projectId={project.id} />
    </div>
  );
}
