import type { ConversationSummaryDto } from '@aparte/bonaparte-shared';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface ConversationSidebarProps {
  conversations: ConversationSummaryDto[];
  currentId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

/** « il y a 3 min », « hier »… — repère grossier, jamais une horloge. */
function relativeDate(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / (60 * 24)), 'day');
}

export function ConversationSidebar({
  conversations,
  currentId,
  busy,
  onSelect,
  onCreate,
}: ConversationSidebarProps) {
  const { t, locale } = useTranslate();

  return (
    <nav className="conv-sidebar" aria-label={t.conversations.heading}>
      <div className="conv-sidebar-head">
        <span className="conv-sidebar-title">{t.conversations.heading}</span>
        <button
          type="button"
          className="conv-new"
          onClick={onCreate}
          disabled={busy}
          title={t.conversations.create}
        >
          + <span className="conv-new-label">{t.conversations.create}</span>
        </button>
      </div>

      {conversations.length === 0 ? (
        <p className="conv-empty">{t.conversations.empty}</p>
      ) : (
        <ul className="conv-list">
          {conversations.map((conversation) => {
            const active = conversation.id === currentId;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={`conv-item${active ? ' conv-item-active' : ''}`}
                  onClick={() => onSelect(conversation.id)}
                  disabled={busy || active}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="conv-item-title">
                    {conversation.title || t.conversations.untitled}
                  </span>
                  <span className="conv-item-meta">
                    <span className={conversation.projectName ? 'conv-project' : 'conv-noproject'}>
                      {conversation.projectName ?? t.conversations.noProject}
                    </span>
                    <span className="conv-date">
                      {relativeDate(conversation.updatedAt, locale)}
                    </span>
                  </span>
                  {/* Le badge n'est affiché que si un état existe VRAIMENT sur
                      disque : c'est notre promesse produit, elle se tient sur
                      pièce ou pas du tout. */}
                  {conversation.hasKvState && (
                    <span className="conv-kv" title={t.conversations.kvReadyHint}>
                      {t.conversations.kvReady}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
