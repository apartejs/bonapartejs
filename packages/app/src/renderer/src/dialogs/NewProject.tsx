/**
 * « Nouveau projet » (board « Nouveau projet »): the person chooses a folder
 * in the system's dialog; the dialog says what the folder holds — read by
 * the core, nothing written, nothing run —, proposes the folder's name, lets
 * them add other folders and choose the conversations' default mode. aparté's
 * kit draws it: `.aparte-dialog` on the native <dialog>, `.aparte-field`,
 * `.aparte-field-choice` (the kit has no segmented radio group: apartejs/aparte#225).
 */

import {
  projectsChooseFolder,
  projectsCreate,
  projectsDetect,
  type PlayMode,
  type ProjectFactsView,
  type ProjectView,
} from '@aparte/bonaparte-shared';
import { createElement, useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

const MODES: readonly PlayMode[] = ['lecture', 'repetition', 'plume', 'impro'];

export interface NewProjectProps {
  open: boolean;
  messages: Messages;
  onClose(): void;
  onCreated(project: ProjectView): void;
}

/** What the folder holds, in the person's words: one line per thing found. */
function foundLines(facts: ProjectFactsView, words: Messages['newProject']): string[] {
  const lines: string[] = [];
  if (facts.git) lines.push(facts.git.branch !== null ? words.git(facts.git.branch) : words.gitDetached(facts.git.commit));
  if (facts.packageManager) lines.push(words.scripts(facts.packageManager, facts.scripts));
  if (facts.instructions) lines.push(words.instructions(facts.instructions));
  if (facts.services.length > 0) lines.push(words.services(facts.services));
  return lines;
}

export function NewProject({ open, messages, onClose, onCreated }: NewProjectProps) {
  const words = messages.newProject;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const nameId = useId();
  const [folder, setFolder] = useState<string | null>(null);
  const [facts, setFacts] = useState<ProjectFactsView | null>(null);
  const [name, setName] = useState('');
  const [others, setOthers] = useState<string[]>([]);
  const [mode, setMode] = useState<PlayMode>('repetition');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setFolder(null);
      setFacts(null);
      setName('');
      setOthers([]);
      setMode('repetition');
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const choose = async (): Promise<void> => {
    const chosen = await bridge.invoke(projectsChooseFolder, undefined);
    if (!chosen) return;
    setFolder(chosen.folder);
    const read = await bridge.invoke(projectsDetect, { folder: chosen.folder });
    setFacts(read);
    setName((current) => (current.trim() === '' || current === facts?.name ? read.name : current));
  };

  const addOther = async (): Promise<void> => {
    const chosen = await bridge.invoke(projectsChooseFolder, undefined);
    if (chosen && chosen.folder !== folder && !others.includes(chosen.folder)) setOthers([...others, chosen.folder]);
  };

  const create = async (): Promise<void> => {
    if (!folder || name.trim() === '') return;
    setBusy(true);
    try {
      const project = await bridge.invoke(projectsCreate, { name: name.trim(), roots: [folder, ...others], defaultMode: mode });
      onCreated(project);
    } finally {
      setBusy(false);
    }
  };

  const lines = facts ? foundLines(facts, words) : [];
  return (
    <dialog ref={dialog} className="aparte-dialog new-project" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h1 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h1>
        <button type="button" className="aparte-dialog__close" aria-label={words.close} onClick={onClose}>
          {createElement('aparte-icon', { name: 'close' })}
        </button>
      </header>
      <div className="aparte-dialog__body new-project__body">
        {folder ? (
          <div className="new-project__folder">
            <div className="new-project__folder-text">
              <code className="new-project__path">{folder}</code>
              <span className="aparte-field-hint">{words.folderHint}</span>
            </div>
            <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--surface" onClick={() => void choose()}>
              {words.change}
            </button>
          </div>
        ) : (
          <div className="new-project__folder new-project__folder--empty">
            <span>{words.empty}</span>
            <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => void choose()}>
              {words.choose}
            </button>
          </div>
        )}

        {facts ? (
          <section className="new-project__found" aria-label={words.found}>
            <h2 className="new-project__heading">{words.found}</h2>
            <ul className="new-project__lines">
              {(lines.length > 0 ? lines : [words.nothing]).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="new-project__fields">
          <div className="new-project__field">
            <label className="aparte-field-label" htmlFor={nameId}>
              {words.name}
            </label>
            <input id={nameId} className="aparte-field" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="new-project__field">
            <span className="aparte-field-label">{words.others}</span>
            {others.map((other) => (
              <div key={other} className="new-project__other">
                <code>{other}</code>
                <button
                  type="button"
                  className="aparte-btn aparte-btn--sm aparte-btn--ghost"
                  aria-label={words.removeFolder}
                  onClick={() => setOthers(others.filter((one) => one !== other))}
                >
                  {words.remove}
                </button>
              </div>
            ))}
            <button type="button" className="aparte-btn aparte-btn--sm aparte-btn--surface" disabled={!folder} onClick={() => void addOther()}>
              {words.addFolder}
            </button>
          </div>
        </div>

        <fieldset className="aparte-fieldset new-project__modes">
          <legend className="aparte-field-label">{words.mode}</legend>
          {MODES.map((one) => (
            <label key={one} className={`aparte-field-choice aparte-field-choice--boxed${mode === one ? ' aparte-field-choice--selected' : ''}`}>
              <input type="radio" className="aparte-radio" name="new-project-mode" checked={mode === one} onChange={() => setMode(one)} />
              <span className="aparte-field-choice__body">
                <strong>{messages.modes[one]}</strong>
                <span className="aparte-field-hint">{words.modeNotes[one]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <footer className="aparte-dialog__footer new-project__footer">
        <span className="new-project__note">{words.note}</span>
        <button type="button" className="aparte-btn aparte-btn--surface" onClick={onClose}>
          {words.cancel}
        </button>
        <button
          type="button"
          className="aparte-btn aparte-btn--primary aparte-btn--solid"
          disabled={!folder || name.trim() === '' || busy}
          aria-busy={busy || undefined}
          onClick={() => void create()}
        >
          {words.create}
        </button>
      </footer>
    </dialog>
  );
}
