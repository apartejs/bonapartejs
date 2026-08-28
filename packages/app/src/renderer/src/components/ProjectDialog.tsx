import type { ProjectSummaryDto } from '@aparte/bonaparte-shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ProjectDialogProps {
  /** null = creation; otherwise editing the given project. */
  project: ProjectSummaryDto | null;
  busy: boolean;
  onSave: (name: string, roots: string[]) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

/**
 * Creating or editing a project: a NAME and an ORDERED set of roots.
 *
 * The order isn't cosmetic — the first root is the one the model resolves
 * its relative paths against. The dialog says so, and allows reordering,
 * otherwise the user would be stuck with a default they wouldn't understand.
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
    // The name is derived from the first folder as long as none has been
    // typed: naming a project is useful, not mandatory on the first action.
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="modal-card max-h-[calc(100vh-96px)] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[19px] font-medium">
            {project ? t.projectDialog.editTitle : t.projectDialog.createTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-name">{t.projectDialog.name}</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.projectDialog.namePlaceholder}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-2">
          {/* A section title rather than a field label: "Source folders"
              must read as a heading above the list, not as the caption of
              the previous field. */}
          <p className="text-sm font-medium">{t.projectDialog.roots}</p>
          <ul className="root-list flex flex-col gap-1.5">
            {roots.map((root, index) => (
              <li
                key={root}
                className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted py-1.5 ps-2.5 pe-2"
              >
                <code
                  className="min-w-0 flex-1 truncate text-start font-mono text-[11.5px] [direction:rtl]"
                  title={root}
                >
                  {root}
                </code>
                {index === 0 && roots.length > 1 && (
                  <Badge
                    variant="outline"
                    className="root-default text-[9.5px] font-normal tracking-wide uppercase"
                  >
                    {t.projectDialog.defaultRoot}
                  </Badge>
                )}
                <span className="root-actions flex flex-none gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title={t.projectDialog.moveUp}
                    aria-label={t.projectDialog.moveUp}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    onClick={() => move(index, 1)}
                    disabled={index === roots.length - 1}
                    title={t.projectDialog.moveDown}
                    aria-label={t.projectDialog.moveDown}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="root-remove size-6 text-muted-foreground hover:text-destructive"
                    onClick={() => setRoots(roots.filter((r) => r !== root))}
                    title={t.projectDialog.removeRoot}
                    aria-label={t.projectDialog.removeRoot}
                  >
                    <X className="size-3.5" />
                  </Button>
                </span>
              </li>
            ))}
            <li className="root-add">
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed text-muted-foreground"
                onClick={() => void addRoot()}
              >
                <Plus />
                {t.projectDialog.addRoot}
              </Button>
            </li>
          </ul>
          {/* A project without a root remains valid: it's a group. We say so
              rather than blocking the save. */}
          {roots.length === 0 && (
            <p className="text-xs leading-normal text-muted-foreground">{t.projectDialog.noRootsNote}</p>
          )}
        </div>

        <DialogFooter className="mt-2 sm:justify-between">
          <div>
            {project && onDelete && (
              <Button
                type="button"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
                disabled={busy}
              >
                {t.projectDialog.delete}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t.projectDialog.cancel}
            </Button>
            <Button type="button" disabled={!canSave} onClick={() => onSave(name.trim(), roots)}>
              {t.projectDialog.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
