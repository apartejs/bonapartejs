import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { BookOpenText, RotateCcw, ScrollText } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface CompactDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What a compaction does, said before it is paid (D-03): the model reads
 * the conversation once more to write a summary, the next message starts
 * from it, and nothing leaves the screen. Cancel holds the focus.
 */
export function CompactDialog({ onConfirm, onCancel }: CompactDialogProps) {
  const { t } = useTranslate();
  const c = t.compactDialog;
  const line = (icon: ReactElement, text: string): ReactElement => (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="text-[13.5px] leading-snug">{text}</span>
    </li>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="compact-dialog sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[19px] font-medium">{c.title}</DialogTitle>
          <DialogDescription className="sr-only">{c.reads}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {line(<BookOpenText />, c.reads)}
          {line(<RotateCcw />, c.restarts)}
          {line(<ScrollText />, c.keeps)}
        </ul>
        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" autoFocus onClick={onCancel}>
            {c.cancel}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {c.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
