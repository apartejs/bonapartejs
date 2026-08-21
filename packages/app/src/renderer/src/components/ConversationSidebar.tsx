import type {
  ConversationSummaryDto,
  ProjectSummaryDto,
  SidebarGroupingDto,
  SidebarSortDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ConversationSidebarProps {
  conversations: ConversationSummaryDto[];
  projects: ProjectSummaryDto[];
  currentId: string | null;
  busy: boolean;
  grouping: SidebarGroupingDto;
  sort: SidebarSortDto;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateProject: () => void;
  onEditProject: (projectId: string) => void;
  onGroupingChange: (grouping: SidebarGroupingDto) => void;
  onSortChange: (sort: SidebarSortDto) => void;
}

/** « il y a 3 min », « hier »… — repère grossier, jamais une horloge. */
function relativeDate(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / (60 * 24)), 'day');
}

/**
 * Menu latéral : conversations groupées par projet.
 *
 * Le groupement est une VUE, calculée depuis la donnée que la conversation
 * possède (son `projectId`) — jamais une structure de stockage. C'est ce qui
 * permet d'offrir « une seule liste » sans rien déplacer sur disque, et c'est
 * l'erreur qu'on évite en ne shardant pas par chemin : le dossier est
 * modifiable, sharder imposerait de bouger des fichiers.
 */
export function ConversationSidebar({
  conversations,
  projects,
  currentId,
  busy,
  grouping,
  sort,
  onSelect,
  onCreate,
  onCreateProject,
  onEditProject,
  onGroupingChange,
  onSortChange,
}: ConversationSidebarProps) {
  const { t, locale } = useTranslate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const sorted = useMemo(() => {
    const copy = [...conversations];
    copy.sort((a, b) =>
      sort === 'title'
        ? (a.title || '').localeCompare(b.title || '')
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    return copy;
  }, [conversations, sort]);

  /** Groupes affichés : un par projet, plus « sans projet » s'il y en a. */
  const groups = useMemo(() => {
    if (grouping === 'flat') return null;
    const byProject = projects.map((project) => ({
      project,
      items: sorted.filter((c) => c.projectId === project.id),
    }));
    const orphans = sorted.filter((c) => !c.projectId);
    return { byProject, orphans };
  }, [grouping, projects, sorted]);

  const row = (conversation: ConversationSummaryDto): ReactElement => {
    const active = conversation.id === currentId;
    return (
      <li key={conversation.id}>
        <button
          type="button"
          className={`conv-item${active ? ' conv-item-active' : ''}`}
          onClick={() => onSelect(conversation.id)}
          disabled={busy || active}
          aria-current={active ? 'true' : undefined}
        >
          <span className="conv-item-title">
            {conversation.title || t.conversations.untitled}
          </span>
          <span className="conv-item-meta">
            {/* En liste à plat, le projet redevient utile sur la ligne ; groupé,
                il serait répété sous son propre titre. */}
            {grouping === 'flat' && (
              <span className={conversation.projectName ? 'conv-project' : 'conv-noproject'}>
                {conversation.projectName ?? t.conversations.noProject}
              </span>
            )}
            {conversation.modelName && (
              <span className="conv-model" title={conversation.modelName}>
                {conversation.modelName}
              </span>
            )}
            <span className="conv-date">{relativeDate(conversation.updatedAt, locale)}</span>
          </span>
          {/* Le badge n'est affiché que si un état existe VRAIMENT sur disque :
              c'est notre promesse produit, elle se tient sur pièce ou pas du
              tout. */}
          {conversation.hasKvState && (
            <span className="conv-kv" title={t.conversations.kvReadyHint}>
              {t.conversations.kvReady}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <nav className="conv-sidebar" aria-label={t.conversations.heading}>
      <div className="conv-sidebar-head">
        <span className="conv-sidebar-title">{t.conversations.heading}</span>
        <span className="conv-sidebar-tools" ref={menuRef}>
          <button
            type="button"
            className="conv-icon-button"
            onClick={() => setMenuOpen(!menuOpen)}
            title={t.conversations.organise}
            aria-expanded={menuOpen}
          >
            ···
          </button>
          <button
            type="button"
            className="conv-new"
            onClick={onCreate}
            disabled={busy}
            title={t.conversations.create}
          >
            +
          </button>

          {menuOpen && (
            <div className="conv-menu popover" role="menu">
              <p className="conv-menu-label">{t.conversations.organise}</p>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={grouping === 'project'}
                className="conv-menu-item"
                onClick={() => onGroupingChange('project')}
              >
                {grouping === 'project' ? '✓ ' : ''}
                {t.conversations.byProject}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={grouping === 'flat'}
                className="conv-menu-item"
                onClick={() => onGroupingChange('flat')}
              >
                {grouping === 'flat' ? '✓ ' : ''}
                {t.conversations.oneList}
              </button>

              <p className="conv-menu-label">{t.conversations.sortBy}</p>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sort === 'updated'}
                className="conv-menu-item"
                onClick={() => onSortChange('updated')}
              >
                {sort === 'updated' ? '✓ ' : ''}
                {t.conversations.sortUpdated}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sort === 'title'}
                className="conv-menu-item"
                onClick={() => onSortChange('title')}
              >
                {sort === 'title' ? '✓ ' : ''}
                {t.conversations.sortTitle}
              </button>

              <p className="conv-menu-label">{t.conversations.projects}</p>
              <button
                type="button"
                role="menuitem"
                className="conv-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateProject();
                }}
              >
                + {t.conversations.newProject}
              </button>
            </div>
          )}
        </span>
      </div>

      {conversations.length === 0 && projects.length === 0 ? (
        <p className="conv-empty">{t.conversations.empty}</p>
      ) : groups ? (
        <div className="conv-groups">
          {groups.byProject.map(({ project, items }) => (
            <section key={project.id} className="conv-group">
              <div className="conv-group-head">
                <button
                  type="button"
                  className="conv-group-title"
                  onClick={() => onEditProject(project.id)}
                  title={t.conversations.editProject}
                >
                  <span aria-hidden="true">▤</span> {project.name}
                </button>
                <span className="conv-group-count">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="conv-group-empty">{t.conversations.groupEmpty}</p>
              ) : (
                <ul className="conv-list">{items.map(row)}</ul>
              )}
            </section>
          ))}

          {groups.orphans.length > 0 && (
            <section className="conv-group">
              <div className="conv-group-head">
                <span className="conv-group-title conv-group-title-dim">
                  {t.conversations.noProject}
                </span>
                <span className="conv-group-count">{groups.orphans.length}</span>
              </div>
              <ul className="conv-list">{groups.orphans.map(row)}</ul>
            </section>
          )}
        </div>
      ) : (
        <ul className="conv-list">{sorted.map(row)}</ul>
      )}
    </nav>
  );
}
