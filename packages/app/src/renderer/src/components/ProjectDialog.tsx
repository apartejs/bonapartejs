import type { ProjectSummaryDto } from '@aparte/bonaparte-shared';
import { useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ProjectDialogProps {
  /** null = création ; sinon édition du projet donné. */
  project: ProjectSummaryDto | null;
  busy: boolean;
  onSave: (name: string, roots: string[]) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

/**
 * Créer ou modifier un projet : un NOM et un ensemble ORDONNÉ de racines.
 *
 * L'ordre n'est pas cosmétique — la première racine est celle contre laquelle
 * le modèle résout ses chemins relatifs. Le dialogue le dit, et permet de
 * réordonner, sinon l'utilisateur subirait un défaut qu'il ne comprendrait pas.
 */
export function ProjectDialog({
  project,
  busy,
  onSave,
  onDelete,
  onCancel,
}: ProjectDialogProps) {
  const { t } = useTranslate();
  const [name, setName] = useState(project?.name ?? '');
  const [roots, setRoots] = useState<string[]>(project?.roots ?? []);

  const addRoot = async (): Promise<void> => {
    const picked = await window.bonaparte.pickDirectory();
    if (!picked || roots.includes(picked)) return;
    setRoots([...roots, picked]);
    // Le nom se déduit du premier dossier tant qu'on n'en a pas saisi un :
    // nommer un projet est utile, pas obligatoire au premier geste.
    if (!name.trim() && roots.length === 0) {
      setName(picked.split(/[\\/]/).filter(Boolean).pop() ?? '');
    }
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= roots.length) return;
    const next = [...roots];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    setRoots(next);
  };

  const canSave = !busy && name.trim() !== '';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-card"
        role="dialog"
        aria-label={project ? t.projectDialog.editTitle : t.projectDialog.createTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{project ? t.projectDialog.editTitle : t.projectDialog.createTitle}</h2>

        <label className="field">
          <span className="field-label">{t.projectDialog.name}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.projectDialog.namePlaceholder}
            autoFocus
          />
        </label>

        <p className="field-label">{t.projectDialog.roots}</p>
        <ul className="root-list">
          {roots.map((root, index) => (
            <li key={root}>
              <code title={root}>{root}</code>
              {index === 0 && roots.length > 1 && (
                <em className="root-default">{t.projectDialog.defaultRoot}</em>
              )}
              <span className="root-actions">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  title={t.projectDialog.moveUp}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === roots.length - 1}
                  title={t.projectDialog.moveDown}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="root-remove"
                  onClick={() => setRoots(roots.filter((r) => r !== root))}
                  title={t.projectDialog.removeRoot}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          <li className="root-add">
            <button type="button" onClick={() => void addRoot()}>
              + {t.projectDialog.addRoot}
            </button>
          </li>
        </ul>
        {/* Un projet sans racine reste licite : c'est un groupe. On le dit
            plutôt que de bloquer l'enregistrement. */}
        {roots.length === 0 && <p className="setup-note">{t.projectDialog.noRootsNote}</p>}

        <div className="modal-actions">
          {project && onDelete && (
            <button type="button" className="danger" onClick={onDelete} disabled={busy}>
              {t.projectDialog.delete}
            </button>
          )}
          <span className="modal-spacer" />
          <button type="button" onClick={onCancel}>
            {t.projectDialog.cancel}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={() => onSave(name.trim(), roots)}
          >
            {t.projectDialog.save}
          </button>
        </div>
      </section>
    </div>
  );
}
