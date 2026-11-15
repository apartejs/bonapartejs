/**
 * Where a new conversation of a git project works (board « Branches et
 * conversations », task 6.7): in the project's folder, or on its own branch
 * — its name, and what it starts from. Chosen before the first message; the
 * branch and its folder are made at its first write.
 */

import { useId } from 'react';
import type { Messages } from '../i18n/index';

export interface Place {
  worksIn: 'folder' | 'branch';
  branch: string;
  base: string;
}

export interface WhereItWorksProps {
  messages: Messages;
  place: Place;
  onChange(place: Place): void;
}

export function WhereItWorks({ messages, place, onChange }: WhereItWorksProps) {
  const words = messages.branches;
  const name = useId();
  const branchId = useId();
  const baseId = useId();
  const folder = place.branch.split('/').pop() ?? '';
  const choice = (worksIn: Place['worksIn'], title: string, note: string) => (
    <label className={`aparte-field-choice aparte-field-choice--boxed${place.worksIn === worksIn ? ' aparte-field-choice--selected' : ''}`}>
      <input type="radio" className="aparte-radio" name={name} checked={place.worksIn === worksIn} onChange={() => onChange({ ...place, worksIn })} />
      <span className="aparte-field-choice__body">
        <strong>{title}</strong>
        <span className="aparte-field-hint">{note}</span>
      </span>
    </label>
  );
  return (
    <div className="where-it-works">
      <div role="radiogroup" aria-label={words.where} className="where-it-works__choices">
        {choice('folder', words.inFolder, words.inFolderNote)}
        {choice('branch', words.ownBranch, words.ownBranchNote)}
      </div>
      {place.worksIn === 'branch' ? (
        <div className="where-it-works__fields">
          <div className="aparte-field">
            <label className="aparte-field-label" htmlFor={branchId}>
              {words.branch}
            </label>
            <input
              id={branchId}
              className="aparte-field__input where-it-works__code"
              value={place.branch}
              spellCheck={false}
              onChange={(event) => onChange({ ...place, branch: event.target.value })}
            />
          </div>
          <div className="aparte-field">
            <label className="aparte-field-label" htmlFor={baseId}>
              {words.base}
            </label>
            <input
              id={baseId}
              className="aparte-field__input where-it-works__code"
              value={place.base}
              spellCheck={false}
              onChange={(event) => onChange({ ...place, base: event.target.value })}
            />
          </div>
          <p className="aparte-field-hint where-it-works__note">{words.folderNote(folder)}</p>
        </div>
      ) : null}
    </div>
  );
}
