import type { ApprovalRequestDto } from '@aparte/bonaparte-shared';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ApprovalDialogProps {
  request: ApprovalRequestDto;
  onRespond: (granted: boolean, always?: boolean) => void;
}

/** Readable preview of what the agent is about to do. */
function preview(request: ApprovalRequestDto): string {
  if (request.command) return request.command;
  const path = request.args['path'];
  if (typeof path === 'string') return path;
  return JSON.stringify(request.args, null, 2);
}

export function ApprovalDialog({ request, onRespond }: ApprovalDialogProps) {
  const { t } = useTranslate();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal-card">
        <p className="bp-eyebrow">{t.approval.eyebrow}</p>
        <h2>{t.approval.title}</h2>
        <p className="approval-tool">{request.tool}</p>
        <pre className="approval-preview">{preview(request)}</pre>
        <div className="approval-actions">
          <button
            type="button"
            className="aparte-btn aparte-btn--neutral aparte-btn--outline"
            onClick={() => onRespond(false)}
          >
            {t.approval.refuse}
          </button>
          <button
            type="button"
            className="aparte-btn aparte-btn--secondary aparte-btn--soft"
            onClick={() => onRespond(true, true)}
          >
            {t.approval.always}
          </button>
          <button
            type="button"
            className="primary aparte-btn aparte-btn--primary aparte-btn--solid"
            autoFocus
            onClick={() => onRespond(true)}
          >
            {t.approval.allow}
          </button>
        </div>
      </section>
    </div>
  );
}
