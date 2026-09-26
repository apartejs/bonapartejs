import type { ProjectSummaryDto } from '@aparte/bonaparte-shared';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { Ellipsis, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { FlankToggle } from './FlankToggle.js';
import { MENU_LABEL } from './menu-styles.js';

interface ConversationHeaderProps {
  title: string;
  project: ProjectSummaryDto | null;
  projects: ProjectSummaryDto[];
  busy: boolean;
  onRename: (title: string) => void;
  onEditProject: () => void;
  onCreateProject: () => void;
  onMoveToProject: (projectId: string | null) => void;
  /** Asks to compact the conversation (the caller confirms first). */
  onCompact: () => void;
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

const POPOVER_LABEL = `mx-2 mb-1.5 ${MENU_LABEL}`;

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
 *
 * Its height and bottom border are those of the panel bar (`--bp-bar`
 * token): the two read as a single line running across the window, even
 * though each belongs to its own column.
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
  onCompact,
  sidebarCollapsed,
  panelCollapsed,
  onToggleSidebar,
  onTogglePanel,
}: ConversationHeaderProps) {
  const { t } = useTranslate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [panel, setPanel] = useState<'none' | 'project' | 'move'>('none');

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <header className="conv-header relative flex h-(--bp-bar) shrink-0 items-center gap-2 border-b bg-card px-2">
      <FlankToggle
        side="start"
        collapsed={sidebarCollapsed}
        label={sidebarCollapsed ? t.layout.expandSidebar : t.layout.collapseSidebar}
        shortcut="Ctrl+B"
        onToggle={onToggleSidebar}
      />

      {/* One panel open at a time: opening one closes the other. */}
      <Popover open={panel === 'project'} onOpenChange={(open) => setPanel(open ? 'project' : 'none')}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'conv-chip h-7 max-w-[260px] rounded-full bg-muted px-2.5 text-xs font-normal',
              project ? 'conv-chip-project' : 'conv-chip-dim text-muted-foreground italic',
            )}
            title={project ? project.name : t.header.noProjectHint}
          >
            <Folder className="size-3.5 opacity-70" aria-hidden="true" />
            <span className="truncate">{project ? project.name : t.header.noProject}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="conv-popover w-[min(430px,calc(100vw-24px))] p-3.5"
          aria-label={t.header.projectPanel}
        >
          {project ? (
            <>
              <p className="conv-popover-name mb-2 font-serif text-sm">{project.name}</p>
              {/* ABSOLUTE paths, because it's the only display that leaves
                  no doubt about what the model can reach. */}
              <ul className="conv-popover-roots mb-2.5 flex flex-col gap-1">
                {project.roots.length === 0 ? (
                  <li className="conv-popover-empty text-xs text-muted-foreground">{t.header.noRoots}</li>
                ) : (
                  project.roots.map((root, index) => (
                    <li key={root} title={root} className="flex min-w-0 items-baseline gap-2">
                      {/* `direction: rtl` truncates the path from the LEFT: on an
                          absolute path, the end (the folder) is what identifies
                          it, the start is common noise. */}
                      <code className="min-w-0 flex-1 truncate text-start font-mono text-[11px] text-muted-foreground [direction:rtl]">
                        {root}
                      </code>
                      {index === 0 && project.roots.length > 1 && (
                        <Badge
                          variant="secondary"
                          className="conv-popover-default text-[9.5px] font-normal tracking-wide uppercase"
                        >
                          {t.header.defaultRoot}
                        </Badge>
                      )}
                    </li>
                  ))
                )}
              </ul>
              {/* What the model is told to follow in this project — or where it
                  would look, so a convention file is one save away. */}
              <p className="conv-popover-instructions mb-2.5 text-[11.5px] leading-snug text-muted-foreground">
                {project.instructions && project.instructions.length > 0
                  ? t.header.instructions.replace('{files}', () => project.instructions?.join(', ') ?? '')
                  : t.header.noInstructions}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="conv-popover-action w-full"
                onClick={onEditProject}
              >
                {t.header.editProject}
              </Button>
            </>
          ) : (
            <>
              <p className="conv-popover-empty mb-2.5 text-xs leading-normal text-muted-foreground">
                {t.header.noProjectExplain}
              </p>
              {/* An existing project is offered before creating one: a
                  conversation started without a project usually belongs to
                  one that already exists. */}
              {projects.length > 0 && (
                <>
                  <p className={POPOVER_LABEL}>{t.header.moveTo}</p>
                  <div className="mb-2 flex flex-col">
                    {projects.map((candidate) => (
                      <Button
                        key={candidate.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="conv-popover-item justify-start font-normal"
                        disabled={busy}
                        onClick={() => {
                          onMoveToProject(candidate.id);
                          setPanel('none');
                        }}
                      >
                        {candidate.name}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="conv-popover-action w-full"
                onClick={onCreateProject}
                disabled={busy}
              >
                {t.header.createProject}
              </Button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {editing ? (
        <Input
          className="conv-title-input h-7 min-w-0 flex-1 font-serif text-[15px]"
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="conv-title h-7 min-w-0 flex-1 cursor-text justify-start border border-transparent px-1.5 font-serif text-[15px] font-normal hover:border-border hover:bg-transparent"
          onClick={() => setEditing(true)}
          title={t.header.rename}
        >
          <span className="truncate">{title || t.conversations.untitled}</span>
        </Button>
      )}

      <span className="conv-header-spacer w-1 flex-none" />

      <DropdownMenu open={panel === 'move'} onOpenChange={(open) => setPanel(open ? 'move' : 'none')}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="conv-header-more size-7 text-muted-foreground"
            aria-label={t.header.actions}
            title={t.header.actions}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="conv-popover-right min-w-56">
          <DropdownMenuItem className="conv-compact" disabled={busy} onSelect={() => onCompact()}>
            {t.header.compact}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className={MENU_LABEL}>{t.header.moveTo}</DropdownMenuLabel>
          {projects.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              className="conv-popover-item"
              disabled={candidate.id === project?.id}
              onSelect={() => onMoveToProject(candidate.id)}
            >
              {candidate.name}
            </DropdownMenuItem>
          ))}
          {project && (
            <DropdownMenuItem
              variant="destructive"
              className="conv-popover-item conv-popover-danger"
              onSelect={() => onMoveToProject(null)}
            >
              {t.header.detach}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
