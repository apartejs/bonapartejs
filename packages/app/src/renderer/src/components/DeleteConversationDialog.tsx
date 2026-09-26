import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface DeleteConversationDialogProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one question before a conversation goes: it names what is erased —
 * the messages AND the saved context — and that nothing brings it back.
 * Cancel holds the focus, so Enter on a stray keystroke keeps everything.
 */
export function DeleteConversationDialog({ title, onConfirm, onCancel }: DeleteConversationDialogProps) {
  const { t } = useTranslate();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="delete-conversation sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[19px] font-medium">
            {t.conversations.deleteTitle}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t.conversations.deleteBody.replace('{title}', title || t.conversations.untitled)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" autoFocus onClick={onCancel}>
            {t.conversations.cancel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t.conversations.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
