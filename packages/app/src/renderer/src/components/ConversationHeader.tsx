import type { ProjectSummaryDto } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { FlankToggle } from './FlankToggle.js';

interface ConversationHeaderProps {
  title: string;
  project: ProjectSummaryDto | null;
  projects: ProjectSummaryDto[];
  busy: boolean;
  onRename: (title: string) => void;
  onEditProject: () => void;
  onCreateProject: () => void;
  onMoveToProject: (projectId: string | null) => void;
  /**
   * Toggles for both flanks. They live HERE, in a fixed position of the
   * chrome, rather than in the panels they hide: a button placed inside the
   * panel it closes disappears along with it — which is what forced us to
   * invent a rail to find it again. Codex, Slack, and Linear all keep them
   * in the top bar.
   */
  sidebarCollapsed: boolean;
  panelCollapsed: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
}

/**
 * Space reserved for the toggle, in pixels: 28 for the button, 8 for the
 * margin, 1 for the seam. All three count — the box is `border-box`, so a
 * forgotten pixel comes out of the button.
 *
 * The right half of the bar is exactly the width of the panel, toggle
 * INCLUDED: this is what aligns its seam with the panel's border. Without
 * accounting for it, the button landed one pixel too far left.
 */

/**
 * Conversation header: what NAMES it and what it SEES.
 *
 * The folder used to live in the bottom bar, which was indefensible: it's
 * specific to the conversation, so it displays where the conversation is.
 * The bottom bar keeps only what's global (engine, context gauge).
 *
 * The project chip opens a panel rather than a file picker: a project
 * carries SEVERAL roots, a plain "choose a folder" wouldn't know how to
 * represent them.
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
  sidebarCollapsed,
  panelCollapsed,
  onToggleSidebar,
  onTogglePanel,
}: ConversationHeaderProps) {
  const { t } = useTranslate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [panel, setPanel] = useState<'none' | 'project' | 'move'>('none');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  // An open panel closes on a click elsewhere: without this, two panels can
  // stay open and the user no longer knows what has focus.
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
      <FlankToggle
        side="start"
        collapsed={sidebarCollapsed}
        label={sidebarCollapsed ? t.layout.expandSidebar : t.layout.collapseSidebar}
        shortcut="Ctrl+B"
        onToggle={onToggleSidebar}
      />

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
        <div className="conv-popover popover" role="dialog" aria-label={t.header.projectPanel}>
          {project ? (
            <>
              <p className="conv-popover-name">{project.name}</p>
              {/* ABSOLUTE paths, because it's the only display that leaves
                  no doubt about what the model can reach. */}
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
        <div className="conv-popover conv-popover-right popover" role="menu">
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

      {/*
        Panel closed, its toggle ends THIS bar; open, it ends the panel's
        bar. Both end at the edge of the window: the button sits at the same
        pixel in both cases, with the same icon.
      */}
      {panelCollapsed && (
        <FlankToggle
          side="end"
          collapsed
          label={t.layout.expandPanel}
          shortcut="Ctrl+Alt+B"
          onToggle={onTogglePanel}
        />
      )}
    </header>
  );
}
