/**
 * The « Fichiers » pane (board « Conversation au travail », task 6.3): the
 * tree of the conversation's perimeter, opened folder by folder — by the
 * mouse, or by the keys of a tree (arrows, Home, End, Enter) — and a file's
 * preview, read-only, with its line numbers. « P » marks a file a change
 * waits on, « M » a file the conversation changed; each says so in words.
 *
 * A file explorer is the app's own: built here, with the roles and keys of
 * the ARIA tree pattern.
 */

import {
  filesChanged,
  filesList,
  filesRead,
  type FileEntryView,
  type FileScopeView,
  type FileTextView,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

export interface FilesPanelProps {
  messages: Messages;
  scope: FileScopeView;
  /** The conversation open, for its « M ». */
  conversationId: string | null;
  /** Where the changes waiting for the person would write, as the model named them. */
  pending: readonly string[];
  /** Changes when what the pane shows may have changed (a turn ended, an approval answered). */
  refresh: number;
}

interface Row {
  entry: FileEntryView;
  level: number;
  parent: string | null;
}

/** A path as the model may write it, as the tree shows it. */
const asShown = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\//, '');

const ROOT = '';

export function FilesPanel({ messages, scope, conversationId, pending, refresh }: FilesPanelProps) {
  const words = messages.files;
  const [children, setChildren] = useState<Record<string, FileEntryView[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  // The file shown: its text, null while it is read, 'failed' when it could not be.
  const [shown, setShown] = useState<{ entry: FileEntryView; text: FileTextView | 'failed' | null } | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const rows = useRef(new Map<string, HTMLDivElement>());
  const scopeKey = JSON.stringify(scope);

  const load = (dir: string | null): void => {
    bridge
      .invoke(filesList, { scope, dir })
      .then((entries) => setChildren((was) => ({ ...was, [dir ?? ROOT]: entries })))
      .catch(() => setChildren((was) => ({ ...was, [dir ?? ROOT]: [] })));
  };

  // A new perimeter: the tree from its top.
  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    setShown(null);
    load(null);
  }, [scopeKey]);

  // What may have changed: the folders open read again, the file shown read again, the « M ».
  useEffect(() => {
    if (refresh === 0) return;
    load(null);
    for (const dir of expanded) load(dir);
    if (shown) open(shown.entry);
  }, [refresh]);

  useEffect(() => {
    if (!conversationId) {
      setChanged(new Set());
      return;
    }
    let current = true;
    bridge
      .invoke(filesChanged, { id: conversationId })
      .then((files) => current && setChanged(new Set(files.map((file) => file.display))))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [conversationId, refresh]);

  const proposed = useMemo(() => new Set(pending.map(asShown)), [pending]);

  // The rows the tree shows: the top, and inside each folder open.
  const visible: Row[] = [];
  const walk = (dir: string, level: number, parent: string | null): void => {
    for (const entry of children[dir] ?? []) {
      visible.push({ entry, level, parent });
      if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, level + 1, entry.path);
    }
  };
  walk(ROOT, 1, null);

  function open(entry: FileEntryView): void {
    setShown({ entry, text: null });
    bridge
      .invoke(filesRead, { scope, path: entry.path })
      .then((text) => setShown((was) => (was?.entry.path === entry.path ? { entry, text } : was)))
      .catch(() => setShown((was) => (was?.entry.path === entry.path ? { entry, text: 'failed' } : was)));
  }

  const toggle = (entry: FileEntryView, to?: boolean): void => {
    const opening = to ?? !expanded.has(entry.path);
    if (opening && !children[entry.path]) load(entry.path);
    setExpanded((was) => {
      const next = new Set(was);
      if (opening) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
  };

  const focus = (path: string | undefined): void => {
    if (!path) return;
    setFocused(path);
    rows.current.get(path)?.focus();
  };

  const act = (entry: FileEntryView): void => {
    if (entry.kind === 'dir') toggle(entry);
    else open(entry);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>, row: Row, index: number): void => {
    const { entry } = row;
    const isOpen = entry.kind === 'dir' && expanded.has(entry.path);
    switch (event.key) {
      case 'ArrowDown':
        focus(visible[index + 1]?.entry.path);
        break;
      case 'ArrowUp':
        focus(visible[index - 1]?.entry.path);
        break;
      case 'Home':
        focus(visible[0]?.entry.path);
        break;
      case 'End':
        focus(visible[visible.length - 1]?.entry.path);
        break;
      case 'ArrowRight':
        if (entry.kind !== 'dir') return;
        if (isOpen) focus(visible[index + 1]?.level === row.level + 1 ? visible[index + 1]!.entry.path : undefined);
        else toggle(entry, true);
        break;
      case 'ArrowLeft':
        if (isOpen) toggle(entry, false);
        else focus(row.parent ?? undefined);
        break;
      case 'Enter':
      case ' ':
        act(entry);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const tabStop = focused && visible.some((row) => row.entry.path === focused) ? focused : visible[0]?.entry.path;
  const text = shown?.text && shown.text !== 'failed' ? shown.text : null;
  const lines = text?.kind === 'text' ? text.text.replace(/\n$/, '').split('\n') : [];

  return (
    <div className="files-pane">
      <div role="tree" aria-label={words.tree} className="files-pane__tree">
        {visible.map((row, index) => {
          const { entry } = row;
          const mark = changed.has(entry.display) ? 'M' : proposed.has(entry.display) ? 'P' : null;
          return (
            <div
              key={entry.path}
              ref={(node) => {
                if (node) rows.current.set(entry.path, node);
                else rows.current.delete(entry.path);
              }}
              role="treeitem"
              {...(mark ? { 'aria-label': `${entry.name}, ${mark === 'M' ? words.modified : words.proposed}` } : {})}
              aria-level={row.level}
              aria-selected={shown?.entry.path === entry.path}
              {...(entry.kind === 'dir' ? { 'aria-expanded': expanded.has(entry.path) } : {})}
              tabIndex={entry.path === tabStop ? 0 : -1}
              className="files-pane__row"
              style={{ paddingInlineStart: `${6 + (row.level - 1) * 14}px` }}
              onClick={() => {
                setFocused(entry.path);
                act(entry);
              }}
              onKeyDown={(event) => onKey(event, row, index)}
            >
              <span className="files-pane__chevron" aria-hidden="true">
                {entry.kind === 'dir' ? <Icon name={expanded.has(entry.path) ? 'chevronDown' : 'chevronRight'} /> : null}
              </span>
              <span className="files-pane__name">{entry.name}</span>
              {mark ? (
                <span className={`files-pane__mark files-pane__mark--${mark === 'M' ? 'modified' : 'proposed'}`} aria-hidden="true">
                  {mark}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {shown ? (
        <section aria-label={words.preview(shown.entry.display)} className="files-pane__preview">
          {shown.text === 'failed' ? (
            <p className="files-pane__note">{words.unreadable}</p>
          ) : text?.kind === 'binary' ? (
            <p className="files-pane__note">{words.binary}</p>
          ) : text?.kind === 'text' ? (
            <>
              <div className="files-pane__code">
                <pre className="files-pane__gutter" aria-hidden="true">
                  {lines.map((_, n) => `${n + 1}`).join('\n')}
                </pre>
                <pre className="files-pane__text">{lines.join('\n')}</pre>
              </div>
              {text.truncated ? <p className="files-pane__note">{words.truncated}</p> : null}
            </>
          ) : null}
        </section>
      ) : (
        <p className="files-pane__note files-pane__choose">{words.choose}</p>
      )}
    </div>
  );
}
