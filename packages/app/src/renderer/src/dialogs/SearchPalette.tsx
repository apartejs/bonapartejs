/**
 * « Rechercher » (board « Rechercher (Ctrl K) »): one field, the results in
 * three groups — the conversations where the words were said (the passage,
 * the words marked), the files of the project, two actions on the words —,
 * the first result chosen. The arrows move, Enter opens, Escape closes (the
 * native dialog's). aparté's kit draws it: `.aparte-dialog`, `.aparte-field`.
 */

import { searchQuery, type SearchResultView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

export interface SearchPaletteProps {
  open: boolean;
  messages: Messages;
  /** The conversation open: its project's files are searched. */
  conversationId: string | null;
  onClose(): void;
  onOpenConversation(id: string): void;
  /** Starts a new conversation with this in the composer. */
  onNewConversation(text: string): void;
  /** Puts this in the composer of the conversation open. */
  onInsert(text: string): void;
}

interface Choice {
  id: string;
  group: 'conversations' | 'files' | 'actions';
  run(): void;
  label: string;
  render(): React.ReactNode;
}

const EMPTY: SearchResultView = { conversations: [], files: [] };

export function SearchPalette({ open, messages, conversationId, onClose, onOpenConversation, onNewConversation, onInsert }: SearchPaletteProps) {
  const words = messages.search;
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResultView>(EMPTY);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery('');
      setResult(EMPTY);
      setSelected(0);
      element.showModal();
      field.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  // What the words find, asked a beat after the last key.
  useEffect(() => {
    if (!open) return;
    const words = query.trim();
    if (words === '') {
      setResult(EMPTY);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void bridge
        .invoke(searchQuery, { query: words, ...(conversationId ? { conversationId } : {}) })
        .then((found) => {
          if (current) {
            setResult(found);
            setSelected(0);
          }
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, query, conversationId]);

  const choices = useMemo<Choice[]>(() => {
    const words = query.trim();
    if (words === '') return [];
    const list: Choice[] = [];
    for (const found of result.conversations) {
      list.push({
        id: `conversation-${found.id}`,
        group: 'conversations',
        label: `${found.title} ${found.excerpt.before}${found.excerpt.match}${found.excerpt.after}`,
        run: () => onOpenConversation(found.id),
        render: () => (
          <>
            <span className="search-palette__title">{found.title || messages.search.untitled}</span>
            <span className="search-palette__excerpt">
              {found.excerpt.before}
              <mark>{found.excerpt.match}</mark>
              {found.excerpt.after}
            </span>
          </>
        ),
      });
    }
    for (const file of result.files) {
      list.push({
        id: `file-${file.path}`,
        group: 'files',
        label: file.path,
        run: () => onInsert(`\`${file.path}\` `),
        render: () => <code>{file.path}</code>,
      });
    }
    list.push(
      {
        id: 'action-code',
        group: 'actions',
        label: messages.search.inCode(words),
        run: () => onNewConversation(messages.search.inCodeAsk(words)),
        render: () => <span>{messages.search.inCode(words)}</span>,
      },
      {
        id: 'action-new',
        group: 'actions',
        label: messages.search.newOn(words),
        run: () => onNewConversation(words),
        render: () => <span>{messages.search.newOn(words)}</span>,
      },
    );
    return list;
  }, [query, result, messages, onInsert, onNewConversation, onOpenConversation]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (choices.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((index) => (index + step + choices.length) % choices.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choices[selected]?.run();
    }
  };

  const groups: { key: Choice['group']; title: string }[] = [
    { key: 'conversations', title: words.conversations },
    { key: 'files', title: words.files },
    { key: 'actions', title: words.actions },
  ];
  const active = choices[selected];
  return (
    <dialog ref={dialog} className="aparte-dialog search-palette" aria-label={words.title} onClose={onClose}>
      <div className="search-palette__head">
        <input
          ref={field}
          className="aparte-field search-palette__field"
          role="combobox"
          aria-label={words.field}
          aria-expanded={choices.length > 0}
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          placeholder={words.field}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className="aparte-kbd">{words.escape}</kbd>
      </div>
      <div id={listId} role="listbox" aria-label={words.results} className="search-palette__results">
        {groups.map(({ key, title }) => {
          const inGroup = choices.filter((choice) => choice.group === key);
          if (inGroup.length === 0) return null;
          return (
            <div key={key} role="group" aria-label={title} className="search-palette__group">
              <div role="presentation" className="search-palette__heading">
                {title}
              </div>
              {inGroup.map((choice) => {
                const index = choices.indexOf(choice);
                return (
                  <div
                    key={choice.id}
                    id={`${listId}-${choice.id}`}
                    role="option"
                    aria-selected={index === selected}
                    aria-label={choice.label}
                    className="search-palette__option"
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => choice.run()}
                  >
                    {choice.render()}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <footer className="search-palette__foot">
        <span>{words.hintMove}</span>
        <span>{words.hintOpen}</span>
        <span>{words.hintClose}</span>
        <span className="search-palette__scope">{words.scope}</span>
      </footer>
    </dialog>
  );
}
