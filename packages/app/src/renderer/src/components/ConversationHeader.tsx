import type { ProjectSummaryDto } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ConversationHeaderProps {
  title: string;
  project: ProjectSummaryDto | null;
  projects: ProjectSummaryDto[];
  busy: boolean;
  onRename: (title: string) => void;
  onEditProject: () => void;
  onCreateProject: () => void;
  onMoveToProject: (projectId: string | null) => void;
}

/**
 * En-tête de la conversation : ce qui la NOMME et ce qu'elle VOIT.
 *
 * Le dossier vivait dans la barre du bas, ce qui était indéfendable : il est
 * propre à la conversation, il s'affiche donc là où la conversation est. La
 * barre du bas ne garde que le global (moteur, jauge de contexte).
 *
 * La pastille de projet ouvre un panneau plutôt qu'un sélecteur de fichiers :
 * un projet porte PLUSIEURS racines, un simple « choisir un dossier » ne
 * saurait pas les représenter.
 */
export function ConversationHeader({
  title,
  project,
  projects,
  busy,
  onRename,
  onEditProject,
  onCreateProject,
  onMoveToProject,
}: ConversationHeaderProps) {
  const { t } = useTranslate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [panel, setPanel] = useState<'none' | 'project' | 'move'>('none');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  // Un panneau ouvert se referme au clic ailleurs : sans ça, deux panneaux
  // peuvent rester ouverts et l'utilisateur ne sait plus ce qui a le focus.
  useEffect(() => {
    if (panel === 'none') return;
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setPanel('none');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [panel]);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <header className="conv-header" ref={wrapRef}>
      <button
        type="button"
        className={`conv-chip ${project ? 'conv-chip-project' : 'conv-chip-dim'}`}
        onClick={() => setPanel(panel === 'project' ? 'none' : 'project')}
        title={project ? project.name : t.header.noProjectHint}
        aria-expanded={panel === 'project'}
      >
        <span className="conv-chip-icon" aria-hidden="true">
          ▤
        </span>
        {project ? project.name : t.header.noProject}
      </button>

      {editing ? (
        <input
          className="conv-title-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(title);
              setEditing(false);
            }
          }}
          aria-label={t.header.rename}
        />
      ) : (
        <button
          type="button"
          className="conv-title"
          onClick={() => setEditing(true)}
          title={t.header.rename}
        >
          {title}
        </button>
      )}

      <span className="conv-header-spacer" />

      <button
        type="button"
        className="conv-header-more"
        onClick={() => setPanel(panel === 'move' ? 'none' : 'move')}
        aria-expanded={panel === 'move'}
        title={t.header.actions}
      >
        ···
      </button>

      {panel === 'project' && (
        <div className="conv-popover" role="dialog" aria-label={t.header.projectPanel}>
          {project ? (
            <>
              <p className="conv-popover-name">{project.name}</p>
              {/* Les chemins ABSOLUS, parce que c'est le seul affichage qui ne
                  laisse aucun doute sur ce que le modèle peut atteindre. */}
              <ul className="conv-popover-roots">
                {project.roots.length === 0 ? (
                  <li className="conv-popover-empty">{t.header.noRoots}</li>
                ) : (
                  project.roots.map((root, index) => (
                    <li key={root} title={root}>
                      <code>{root}</code>
                      {index === 0 && project.roots.length > 1 && (
                        <em className="conv-popover-default">{t.header.defaultRoot}</em>
                      )}
                    </li>
                  ))
                )}
              </ul>
              <button type="button" className="conv-popover-action" onClick={onEditProject}>
                {t.header.editProject}
              </button>
            </>
          ) : (
            <>
              <p className="conv-popover-empty">{t.header.noProjectExplain}</p>
              <button
                type="button"
                className="conv-popover-action"
                onClick={onCreateProject}
                disabled={busy}
              >
                {t.header.createProject}
              </button>
            </>
          )}
        </div>
      )}

      {panel === 'move' && (
        <div className="conv-popover conv-popover-right" role="menu">
          <p className="conv-popover-label">{t.header.moveTo}</p>
          {projects.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="menuitem"
              className="conv-popover-item"
              disabled={candidate.id === project?.id}
              onClick={() => {
                onMoveToProject(candidate.id);
                setPanel('none');
              }}
            >
              {candidate.name}
            </button>
          ))}
          {project && (
            <button
              type="button"
              role="menuitem"
              className="conv-popover-item conv-popover-danger"
              onClick={() => {
                onMoveToProject(null);
                setPanel('none');
              }}
            >
              {t.header.detach}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
