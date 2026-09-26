import type {
  ConversationSummaryDto,
  ProjectSummaryDto,
  SidebarGroupingDto,
  SidebarSortDto,
} from '@aparte/bonaparte-shared';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { Ellipsis, Folder, Plus, Trash2 } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { MENU_LABEL } from './menu-styles.js';

interface ConversationSidebarProps {
  conversations: ConversationSummaryDto[];
  projects: ProjectSummaryDto[];
  currentId: string | null;
  busy: boolean;
  grouping: SidebarGroupingDto;
  sort: SidebarSortDto;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateInProject: (projectId: string) => void;
  onCreateProject: () => void;
  onEditProject: (projectId: string) => void;
  onGroupingChange: (grouping: SidebarGroupingDto) => void;
  onSortChange: (sort: SidebarSortDto) => void;
  /** Asks to delete a conversation — the caller confirms before anything goes. */
  onDelete: (conversation: ConversationSummaryDto) => void;
}

/** "3 min ago", "yesterday"… — a rough marker, never a clock. */
function relativeDate(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / (60 * 24)), 'day');
}

const GROUP_HEAD = 'conv-group-head flex items-center gap-1.5 pt-1.5 pb-[3px] ps-2.5 pe-3.5';
const GROUP_COUNT = 'conv-group-count flex-none text-[11px] text-muted-foreground tabular-nums';

/**
 * Sidebar menu: conversations grouped by project.
 *
 * Grouping is a VIEW, computed from the data the conversation already owns
 * (its `projectId`) — never a storage structure. This is what makes it
 * possible to offer a "single list" without moving anything on disk, and
 * it's the mistake we avoid by not sharding by path: the folder can change,
 * sharding would force moving files around.
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
  onCreateInProject,
  onCreateProject,
  onEditProject,
  onGroupingChange,
  onSortChange,
  onDelete,
}: ConversationSidebarProps) {
  const { t, locale } = useTranslate();

  const sorted = useMemo(() => {
    const copy = [...conversations];
    copy.sort((a, b) =>
      sort === 'title'
        ? (a.title || '').localeCompare(b.title || '')
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    return copy;
  }, [conversations, sort]);

  /** Groups displayed: one per project, plus "no project" if there are any. */
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
      <li key={conversation.id} className="conv-row group relative">
        {/* A row: the title on its line, the rest muted underneath. No
            frame — the chosen row is told by a tint and a bar on the start
            edge, the hovered one by a surface. */}
        <button
          type="button"
          data-slot="conv-item"
          className={cn(
            'conv-item mb-px flex w-full flex-col gap-0.5 rounded-md border-s-2 border-transparent py-1.5 ps-2.5 pe-2.5 text-start text-foreground',
            active
              ? 'conv-item-active border-primary bg-accent/60'
              : 'hover:bg-muted disabled:opacity-60',
          )}
          onClick={() => onSelect(conversation.id)}
          disabled={busy || active}
          aria-current={active ? 'true' : undefined}
        >
          <span className="conv-item-line flex min-w-0 items-center gap-1.5">
            <span className="conv-item-title min-w-0 flex-1 truncate text-[13px] leading-[1.35]">
              {conversation.title || t.conversations.untitled}
            </span>
            {/* The badge only shows if a state REALLY exists on disk: this is
                our product promise, it stands on hard evidence or not at all. */}
            {conversation.hasKvState && (
              <Badge
                variant="secondary"
                className="conv-kv px-1.5 py-0 font-mono text-[9.5px] leading-[15px] font-normal tracking-wide text-emerald-700 dark:text-emerald-300"
                title={t.conversations.kvReadyHint}
              >
                {t.conversations.kvReady}
              </Badge>
            )}
          </span>
          <span className="conv-item-meta flex min-w-0 items-center text-[11px] leading-[1.3] text-muted-foreground [&>*+*]:before:mx-[5px] [&>*+*]:before:opacity-60 [&>*+*]:before:content-['·']">
            {/* In flat-list mode, the project becomes useful again on the
                row; grouped, it would be repeated under its own heading. */}
            {grouping === 'flat' && (
              <span
                className={cn(
                  'min-w-0 truncate',
                  conversation.projectName ? 'conv-project' : 'conv-noproject italic',
                )}
              >
                {conversation.projectName ?? t.conversations.noProject}
              </span>
            )}
            {conversation.modelName && (
              <span className="conv-model min-w-0 truncate font-mono text-[10.5px]" title={conversation.modelName}>
                {conversation.modelName}
              </span>
            )}
            <span className="conv-date ms-auto flex-none ps-2 whitespace-nowrap">
              {relativeDate(conversation.updatedAt, locale)}
            </span>
          </span>
        </button>
        {/* The row's own actions: a ⋯ that shows on hover or focus, over the
            end of the row — its surface covers the date beneath it. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="conv-row-menu absolute end-1.5 top-1.5 size-6 bg-card text-muted-foreground opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              disabled={busy}
              title={t.conversations.rowMenu}
              aria-label={t.conversations.rowMenu}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(conversation)}>
              <Trash2 />
              {t.conversations.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <nav className="conv-sidebar flex min-h-0 flex-col border-e bg-card" aria-label={t.conversations.heading}>
      <div className="conv-sidebar-head flex items-center justify-between gap-2 pt-3 pb-1.5 ps-3.5 pe-2.5">
        <span className="conv-sidebar-title text-[11.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t.conversations.heading}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              title={t.conversations.organise}
              aria-label={t.conversations.organise}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="conv-menu min-w-56">
            <DropdownMenuLabel className={MENU_LABEL}>{t.conversations.organise}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={grouping}
              onValueChange={(value) => onGroupingChange(value as SidebarGroupingDto)}
            >
              <DropdownMenuRadioItem value="project">{t.conversations.byProject}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="flat">{t.conversations.oneList}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={MENU_LABEL}>{t.conversations.sortBy}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as SidebarSortDto)}>
              <DropdownMenuRadioItem value="updated">{t.conversations.sortUpdated}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="title">{t.conversations.sortTitle}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={MENU_LABEL}>{t.conversations.projects}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onCreateProject()}>
              <Plus />
              {t.conversations.newProject}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The first thing one does here, as a button one can read — not a
          glyph in a corner. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="conv-new mx-2.5 mb-2.5 justify-start bg-accent text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground"
        onClick={onCreate}
        disabled={busy}
      >
        <Plus />
        {t.conversations.create}
      </Button>

      {conversations.length === 0 && projects.length === 0 ? (
        <p className="conv-empty px-3.5 pt-1 pb-3.5 text-[12.5px] text-muted-foreground">{t.conversations.empty}</p>
      ) : groups ? (
        <div className="conv-groups min-h-0 overflow-y-auto pb-2.5">
          {groups.byProject.map(({ project, items }) => (
            <section key={project.id} className="conv-group mt-2.5 first:mt-0">
              <div className={GROUP_HEAD}>
                {/* A project heading: a name, its count — a ghost button so the
                    name is clickable (it opens the project) without looking
                    like a link. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="conv-group-title h-6 min-w-0 flex-1 justify-start px-2 text-xs font-semibold text-muted-foreground"
                  onClick={() => onEditProject(project.id)}
                  title={t.conversations.editProject}
                >
                  <Folder className="size-3.5" aria-hidden="true" />
                  <span className="truncate">{project.name}</span>
                </Button>
                <span className={GROUP_COUNT}>{items.length}</span>
                {/* A new conversation right in this project, not the current one. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="conv-group-new size-5 text-muted-foreground"
                  onClick={() => onCreateInProject(project.id)}
                  disabled={busy}
                  title={t.conversations.newInProject}
                  aria-label={t.conversations.newInProject}
                >
                  <Plus />
                </Button>
              </div>
              {items.length === 0 ? (
                <p className="conv-group-empty mx-3 mb-1.5 text-[11.5px] text-muted-foreground italic">
                  {t.conversations.groupEmpty}
                </p>
              ) : (
                <ul className="conv-list px-2">{items.map(row)}</ul>
              )}
            </section>
          ))}

          {groups.orphans.length > 0 && (
            <section className="conv-group mt-2.5 first:mt-0">
              <div className={GROUP_HEAD}>
                <span className="conv-group-title conv-group-title-dim min-w-0 flex-1 truncate px-2 text-xs font-medium text-muted-foreground">
                  {t.conversations.noProject}
                </span>
                <span className={GROUP_COUNT}>{groups.orphans.length}</span>
              </div>
              <ul className="conv-list px-2">{groups.orphans.map(row)}</ul>
            </section>
          )}
        </div>
      ) : (
        <ul className="conv-list min-h-0 overflow-y-auto px-2 pb-3">{sorted.map(row)}</ul>
      )}
    </nav>
  );
}
