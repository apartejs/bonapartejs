/**
 * « Travailler dans un projet… » (task 9.7): a discussion goes on as a code conversation of a project — one of
 * the projects, or a new one. Nothing is read again: its next turn tells the model the tools, the folders and
 * the mode, after what it already said.
 */

import type { ProjectView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { Messages } from '../i18n/index';

export interface AttachProjectProps {
  open: boolean;
  messages: Messages;
  projects: readonly ProjectView[];
  busy: boolean;
  failed: boolean;
  onCancel(): void;
  onAttach(projectId: string): void;
  onNewProject(): void;
}

export function AttachProject({ open, messages, projects, busy, failed, onCancel, onAttach, onNewProject }: AttachProjectProps) {
  const words = messages.attachProject;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setPicked(projects[0]?.id ?? null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, projects]);
  return (
    <dialog ref={dialog} className="aparte-dialog attach-project" aria-labelledby={titleId} onCancel={(event) => busy && event.preventDefault()} onClose={onCancel}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        <p>{words.lede}</p>
        {projects.length === 0 ? (
          <p className="aparte-field-hint">{words.none}</p>
        ) : (
          <div role="radiogroup" aria-label={words.title} className="attach-project__list">
            {projects.map((project) => (
              <label key={project.id} className="aparte-choice attach-project__choice">
                <input type="radio" name="attach-project" value={project.id} checked={picked === project.id} onChange={() => setPicked(project.id)} />
                <span className="attach-project__name">{project.name}</span>
                <span className="aparte-field-hint">{project.roots[0] ?? ''}</span>
              </label>
            ))}
          </div>
        )}
        {failed ? (
          <p className="model-switch-dialog__refused" role="alert">
            {words.failed}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" disabled={busy} onClick={onNewProject}>
          {words.newProject}
        </button>
        <button type="button" className="aparte-btn aparte-btn--outline" disabled={busy} onClick={onCancel}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={busy || picked === null}
          aria-busy={busy || undefined}
          onClick={() => picked && onAttach(picked)}
        >
          {words.confirm}
        </button>
      </footer>
    </dialog>
  );
}
