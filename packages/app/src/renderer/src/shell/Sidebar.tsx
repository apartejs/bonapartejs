/**
 * The sidebar (board « Conversation au travail », §8.1): the name, fold it,
 * a new conversation, « Rechercher » (Ctrl K); the projects, each with its
 * conversations; then « Discussions », the conversations without a project;
 * the engine at the foot. With « one list » (the setting), every conversation
 * in aparté's list, by date.
 *
 * aparté's list groups by date only (apartejs/aparte#229): a project is a
 * header of ours above a `flat` list of its own conversations — the list keeps
 * its menu, its rename, its pins and its statuses.
 */

import { AparteConversationList } from '@aparte/react';
import type { EngineStateView, ProjectView } from '@aparte/bonaparte-shared';
import { useMemo, useState } from 'react';
import type { Messages } from '../i18n/index';
import { EngineCard } from './EngineCard';
import { Icon } from './icons';
import { TipButton } from './TipButton';

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
  engine: EngineStateView;
  conversations: readonly ListedConversation[];
  activeId: string | null;
  projects: readonly ProjectView[];
  /** The project each conversation works in: what the core says, else where it was started here. */
  projectOf(id: string): string | null;
  grouping: 'project' | 'single';
  onCollapse(): void;
  onNewConversation(): void;
  onSearch(): void;
  onNewProject(): void;
}

function List({ items, activeId, flat }: { items: readonly ListedConversation[]; activeId: string | null; flat: boolean }) {
  // aparté's list draws itself again whenever it is given a new array — closing a row's open
  // menu: it gets a new one only when what it draws has changed.
  const drawn = items.map((item) => [item.id, item.title, item.updatedAt, item.pinnedAt, item.archivedAt].join('\u0000')).join('\u0001');
  const conversations = useMemo(() => [...items], [drawn]);
  return (
    <AparteConversationList
      className="bonaparte-conversations"
      conversations={conversations}
      active-id={activeId ?? ''}
      manage
      {...(flat ? { flat: true } : {})}
    />
  );
}

function ProjectGroup({
  project,
  items,
  activeId,
  messages,
}: {
  project: ProjectView;
  items: readonly ListedConversation[];
  activeId: string | null;
  messages: Messages;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div role="group" aria-label={project.name} className="bonaparte-project">
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
      {open && items.length > 0 ? <List items={items} activeId={activeId} flat /> : null}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { messages, conversations, activeId, projects, projectOf } = props;
  const words = messages.shell;
  const known = new Set(projects.map((project) => project.id));
  const inProject = (id: string): string | null => {
    const project = projectOf(id);
    return project !== null && known.has(project) ? project : null;
  };
  const discussions = conversations.filter((conversation) => inProject(conversation.id) === null);
  return (
    <nav className="aparte-sidebar bonaparte-sidebar" aria-label={words.nav}>
      <div className="bonaparte-sidebar__top">
        <span className="bonaparte-wordmark">{words.brand}</span>
        <TipButton label={words.collapse} tip={words.collapseTip} icon="panel" onClick={props.onCollapse} />
        <TipButton label={words.newConversation} icon="plus" className="bonaparte-bordered" onClick={props.onNewConversation} />
      </div>
      <button type="button" className="bonaparte-search-field" aria-label={words.searchLabel} onClick={props.onSearch}>
        <Icon name="search" />
        <span className="bonaparte-search-field__text">{words.search}</span>
        <kbd className="aparte-kbd">{messages.search.shortcut}</kbd>
      </button>
      <div className="bonaparte-sidebar__body">
        {props.grouping === 'single' ? (
          <List items={conversations} activeId={activeId} flat={false} />
        ) : (
          <>
            <section className="bonaparte-section">
              <div className="bonaparte-section__head">
                <h2 className="bonaparte-section__title">{words.projects}</h2>
                <TipButton label={messages.newProject.open} icon="plus" onClick={props.onNewProject} />
              </div>
              {projects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  items={conversations.filter((conversation) => inProject(conversation.id) === project.id)}
                  activeId={activeId}
                  messages={messages}
                />
              ))}
            </section>
            {discussions.length > 0 ? (
              <section role="group" aria-label={words.discussions} className="bonaparte-section">
                <div className="bonaparte-section__head">
                  <h2 className="bonaparte-section__title" aria-hidden="true">
                    {words.discussions}
                  </h2>
                </div>
                <List items={discussions} activeId={activeId} flat />
              </section>
            ) : null}
          </>
        )}
      </div>
      <EngineCard engine={props.engine} messages={messages} />
    </nav>
  );
}
