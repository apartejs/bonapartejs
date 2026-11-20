/**
 * The sidebar (board « Conversation au travail », §8.1): the name, fold it,
 * a new conversation, « Rechercher » (Ctrl K); the projects, each with its
 * conversations; then « Discussions », the conversations without a project;
 * the engine at the foot. With « one list » (the setting), every conversation
 * in aparté's list, by date.
 *
 * A project is a header of ours above a `flat` list of its own
 * conversations: it folds and counts them, which aparté's group headings
 * (`group`) do not — the list keeps its menu, its rename, its pins and its
 * statuses. Each row's memory is a mark of the row (`renderMeta`).
 *
 * A conversation moves to another project (aparté 1.16, apartejs/aparte#269): « Déplacer vers… » in its row's
 * menu, each list offering the other projects (`moveTargets`), or its row dragged onto a project — our lists are
 * one per project, and aparté drops only within one list, so the project's group reads the row's id from the drag
 * (apartejs/aparte#278).
 */

import { AparteConversationList } from '@aparte/react';
import type { EngineStateView, ProjectView, ResourceSampleView } from '@aparte/bonaparte-shared';
import { useMemo, useState, type DragEvent } from 'react';
import { CHATS_TARGET } from '../chat/ChatDeck';
import type { Messages } from '../i18n/index';
import { EngineCard } from './EngineCard';
import { Icon } from './icons';
import { rowMarks, type Memory, type RowPr } from './statuses';
import { TipButton } from './TipButton';
import { Mascot } from '../logo/Mascot';
import type { MascotState } from '../logo/mascot-state';
import { keysOf } from '../shortcuts/registry';
import { useBindings } from '../shortcuts/useShortcuts';

/** A conversation as aparté's manager lists it: what the list draws. */
export interface ListedConversation {
  id: string;
  title: string;
  updatedAt?: number;
  pinnedAt?: number;
  archivedAt?: number;
}

export interface SidebarProps {
  messages: Messages;
  /** The mascot's state (task 12.2). */
  mascot: MascotState;
  /** « Moniteur de ressources » (task 12.4): the last reading while it is on. */
  resources?: ResourceSampleView | null;
  locale?: string;
  engine: EngineStateView;
  conversations: readonly ListedConversation[];
  activeId: string | null;
  projects: readonly ProjectView[];
  /** The project each conversation works in: what the core says, else where it was started here. */
  projectOf(id: string): string | null;
  /** Where each conversation's memory is, and its branch's changed files, as the core says. */
  marksOf(id: string): { memory: Memory; branchFiles?: number; pr?: RowPr; unread?: boolean };
  grouping: 'project' | 'single';
  onCollapse(): void;
  onNewConversation(): void;
  onSearch(): void;
  onNewProject(): void;
  /** A project's « + »: a conversation in that project. */
  onNewConversationIn?(projectId: string): void;
  /** « Nouvelle discussion » (task 9.7). */
  onNewDiscussion?(): void;
  onSettings(): void;
  /** A conversation moved to a project (aparté 1.16, apartejs/aparte#269). */
  onMove?(conversationId: string, projectId: string): void;
  /** Why the last move did not happen, said until it is closed. */
  moveNotice?: { text: string; onDismiss(): void } | null;
  /** « À traiter » (task 8.4): what waits for the person, counted; the page open. */
  inbox: { count: number; open: boolean; onOpen(): void };
  /** « Mises à jour » (task 13.1): shown only when one is ready. */
  updates?: { count: number; onOpen(): void };
}

/** A row as the list draws it: the conversation, where its memory is, its branch's files. */
type Row = ListedConversation & { memory: Memory; branchFiles?: number; pr?: RowPr; unread?: boolean };

/** Where a list's rows may go: the projects, as aparté's list names a group. */
type Target = { key: string; label: string };

/** What aparté's list puts in a row's drag: its id (apartejs/aparte#278 asks for it to be documented). */
const DRAGGED = 'application/x-aparte-conversation';

function List({
  items,
  activeId,
  flat,
  words,
  targets = [],
  onMove,
}: {
  items: readonly Row[];
  activeId: string | null;
  flat: boolean;
  words: Messages;
  targets?: readonly Target[];
  onMove?: (conversationId: string, projectId: string) => void;
}) {
  // aparté's list draws itself again whenever it is given a new array — closing a row's open
  // menu: it gets a new one only when what it draws has changed.
  const drawn = items
    .map((item) => [item.id, item.title, item.updatedAt, item.pinnedAt, item.archivedAt, item.memory, item.branchFiles, item.pr ? `${item.pr.number}${item.pr.state}${item.pr.ci}` : '', item.unread ? 'unread' : ''].join('\u0000'))
    .join('\u0001');
  // A flat list has no « Épinglées » group: a pinned conversation comes first, the last pinned at the top.
  const conversations = useMemo(
    () => [...items.filter((item) => item.pinnedAt).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)), ...items.filter((item) => !item.pinnedAt)],
    [drawn],
  );
  // A new function draws the rows again: one only when what they show has changed.
  const renderMeta = useMemo(() => {
    const marks = new Map(items.map((item) => [item.id, item]));
    return (item: { id: string }) =>
      rowMarks(marks.get(item.id)?.memory ?? null, marks.get(item.id)?.branchFiles, words, marks.get(item.id)?.pr, marks.get(item.id)?.unread === true);
  }, [drawn, words]);
  // The same array while the projects are the same: a new one draws the rows again, closing an open menu.
  const targetsKey = targets.map((target) => `${target.key}\u0000${target.label}`).join('\u0001');
  const moveTargets = useMemo(() => targets.map((target) => ({ ...target })), [targetsKey]);
  return (
    <AparteConversationList
      className="bonaparte-conversations"
      conversations={conversations}
      active-id={activeId ?? ''}
      // The list drives the deck of chats, not one of them: the page shows the chat of the conversation picked.
      target={CHATS_TARGET}
      renderMeta={renderMeta}
      manage
      {...(flat ? { flat: true } : {})}
      {...(onMove && moveTargets.length > 0
        ? { moveTargets, onConversationMove: (detail: { id: string; to: string | null }) => (detail.to ? onMove(detail.id, detail.to) : undefined) }
        : {})}
    />
  );
}

function ProjectGroup({
  project,
  items,
  activeId,
  messages,
  onNew,
  targets,
  onMove,
}: {
  project: ProjectView;
  items: readonly Row[];
  activeId: string | null;
  messages: Messages;
  onNew?: (projectId: string) => void;
  targets: readonly Target[];
  onMove?: (conversationId: string, projectId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dropping, setDropping] = useState(false);
  // A row of another project dragged here: the group takes it (apartejs/aparte#278).
  const carries = (event: DragEvent): boolean => onMove !== undefined && event.dataTransfer.types.includes(DRAGGED);
  const over = (event: DragEvent<HTMLDivElement>): void => {
    if (!carries(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropping(true);
  };
  const leave = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
  };
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    setDropping(false);
    if (!carries(event)) return;
    const id = event.dataTransfer.getData(DRAGGED);
    // Its own rows dropped back: nothing moves.
    if (!id || items.some((item) => item.id === id)) return;
    event.preventDefault();
    onMove?.(id, project.id);
  };
  return (
    <div
      role="group"
      aria-label={project.name}
      className={`bonaparte-project${dropping ? ' bonaparte-project--drop' : ''}`}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
    >
      <div className="bonaparte-project__head">
        <button
          type="button"
          className="bonaparte-project__header"
          aria-expanded={open}
          aria-label={messages.shell.project(project.name, items.length)}
          onClick={() => setOpen((was) => !was)}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          <Icon name="folder" />
          <span className="bonaparte-project__name">{project.name}</span>
          <span className="bonaparte-project__count">{items.length}</span>
        </button>
        {onNew ? (
          <TipButton
            label={messages.shell.newConversationIn(project.name)}
            icon="plus"
            side="bottom-end"
            className="bonaparte-project__new"
            onClick={() => onNew(project.id)}
          />
        ) : null}
      </div>
      {open && items.length > 0 ? (
        <List items={items} activeId={activeId} flat words={messages} targets={targets} {...(onMove ? { onMove } : {})} />
      ) : null}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { messages, activeId, projects, projectOf, marksOf } = props;
  const words = messages.shell;
  const bindings = useBindings();
  // The pointer over the mark surprises it, when it has nothing more urgent to say.
  const [hovered, setHovered] = useState(false);
  const mascot: MascotState = hovered && props.mascot === 'idle' ? 'surprised' : props.mascot;
  const conversations: Row[] = props.conversations.map((conversation) => {
    const marks = marksOf(conversation.id);
    return {
      ...conversation,
      memory: marks.memory,
      ...(marks.branchFiles !== undefined ? { branchFiles: marks.branchFiles } : {}),
      ...(marks.pr ? { pr: marks.pr } : {}),
      ...(marks.unread ? { unread: true } : {}),
    };
  });
  const known = new Set(projects.map((project) => project.id));
  const inProject = (id: string): string | null => {
    const project = projectOf(id);
    return project !== null && known.has(project) ? project : null;
  };
  const discussions = conversations.filter((conversation) => inProject(conversation.id) === null);
  // Where a row may go: every project, its own excepted.
  const allTargets: Target[] = projects.map((project) => ({ key: project.id, label: project.name }));
  const move = props.onMove ? { onMove: props.onMove } : {};
  return (
    <nav className="aparte-sidebar bonaparte-sidebar" aria-label={words.nav}>
      <div className="bonaparte-sidebar__top">
        <span className="bonaparte-brand" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
          <Mascot className="bonaparte-brand__mark" state={mascot} label={words.mascot.label(words.mascot.states[mascot])} />
          <span className="bonaparte-wordmark">{words.brand}</span>
        </span>
        <TipButton label={words.collapse} tip={words.collapseTip} icon="panel" onClick={props.onCollapse} />
        <TipButton label={words.newConversation} icon="plus" className="bonaparte-bordered" onClick={props.onNewConversation} />
        {/* One list has no « Discussions » section: its button stands here (review of phase 9). */}
        {props.grouping === 'single' && props.onNewDiscussion ? (
          <TipButton label={words.newDiscussion} icon="conversation" onClick={props.onNewDiscussion} />
        ) : null}
      </div>
      <button type="button" className="bonaparte-search-field" aria-label={words.searchLabel} onClick={props.onSearch}>
        <Icon name="search" />
        <span className="bonaparte-search-field__text">{words.search}</span>
        <kbd className="aparte-kbd">{messages.search.shortcut}</kbd>
      </button>
      <button
        type="button"
        className="bonaparte-inbox-entry"
        aria-current={props.inbox.open ? 'page' : undefined}
        aria-label={props.inbox.count > 0 ? words.inboxCount(props.inbox.count) : words.inbox}
        title={`${words.inbox} · ${keysOf(bindings.inbox, messages.settings.shortcuts.keys).join(' ')}`}
        onClick={props.inbox.onOpen}
      >
        <Icon name="inbox" />
        <span className="bonaparte-inbox-entry__text">{words.inbox}</span>
        {props.inbox.count > 0 ? (
          <span className="bonaparte-inbox-entry__count" aria-hidden="true">
            {props.inbox.count}
          </span>
        ) : null}
      </button>
      {/* Why a move did not happen: above the lists, which scroll — one live region, always there. */}
      <div role="status" className="bonaparte-move-status">
        {props.moveNotice ? (
          <div className="aparte-alert aparte-alert--warning bonaparte-move-notice">
            <span className="bonaparte-move-notice__text">{props.moveNotice.text}</span>
            <TipButton label={words.dismiss} icon="close" onClick={props.moveNotice.onDismiss} />
          </div>
        ) : null}
      </div>
      <div className="bonaparte-sidebar__body">
        {props.grouping === 'single' ? (
          <List items={conversations} activeId={activeId} flat={false} words={messages} targets={allTargets} {...move} />
        ) : (
          <>
            <section className="bonaparte-section">
              <div className="bonaparte-section__head">
                <h2 className="bonaparte-section__title">{words.projects}</h2>
                <TipButton label={messages.newProject.open} icon="plus" side="bottom-end" onClick={props.onNewProject} />
              </div>
              {projects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  items={conversations.filter((conversation) => inProject(conversation.id) === project.id)}
                  activeId={activeId}
                  messages={messages}
                  {...(props.onNewConversationIn ? { onNew: props.onNewConversationIn } : {})}
                  targets={allTargets.filter((target) => target.key !== project.id)}
                  {...move}
                />
              ))}
            </section>
            <section role="group" aria-label={words.discussions} className="bonaparte-section">
              <div className="bonaparte-section__head">
                <h2 className="bonaparte-section__title" aria-hidden="true">
                  {words.discussions}
                </h2>
                {/* A conversation without a project (task 9.7): the web and what it knows, no file. */}
                {props.onNewDiscussion ? <TipButton label={words.newDiscussion} icon="plus" side="bottom-end" onClick={props.onNewDiscussion} /> : null}
              </div>
              {discussions.length > 0 ? <List items={discussions} activeId={activeId} flat words={messages} targets={allTargets} {...move} /> : null}
            </section>
          </>
        )}
      </div>
      <EngineCard engine={props.engine} messages={messages} resources={props.resources ?? null} {...(props.locale ? { locale: props.locale } : {})} />
      {props.updates && props.updates.count > 0 ? (
        <button type="button" className="bonaparte-settings-link bonaparte-updates-link" aria-label={messages.updates.openCount(props.updates.count)} onClick={props.updates.onOpen}>
          <Icon name="update" />
          {messages.updates.open}
          <span className="bonaparte-inbox-entry__count" aria-hidden="true">
            {props.updates.count}
          </span>
        </button>
      ) : null}
      <button type="button" className="bonaparte-settings-link" onClick={props.onSettings}>
        <Icon name="settings" />
        {messages.settings.open}
      </button>
    </nav>
  );
}
