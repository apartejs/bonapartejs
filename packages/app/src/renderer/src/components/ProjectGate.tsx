import type { ProjectDto } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ProjectGateProps {
  busy: boolean;
  error: string | null;
  onOpen: (project: ProjectDto) => void;
}

export function ProjectGate({ busy, error, onOpen }: ProjectGateProps) {
  const { t } = useTranslate();
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    void window.bonaparte.currentProject().then((project) => {
      if (project) setRecents(project.recents);
    });
  }, []);

  const choose = async (): Promise<void> => {
    const project = await window.bonaparte.openProject();
    if (project) onOpen(project);
  };

  return (
    <div className="setup-wrap">
      <section className="setup-card">
        <p className="bp-eyebrow">{t.project.eyebrow}</p>
        <h1>{t.project.title}</h1>
        <p className="setup-intro">{t.project.intro}</p>

        {recents.length > 0 && (
          <ul className="model-list">
            {recents.map((path) => (
              <li key={path}>
                <button type="button" className="recent-row" title={path}>
                  <span className="model-name">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="setup-error">
            {t.setup.failed} — {error}
          </p>
        )}

        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void choose()}
        >
          {busy ? t.setup.starting : t.project.choose}
        </button>
      </section>
    </div>
  );
}
