/**
 * After going back before a message (board « Revenir en arrière », task
 * 7.2): what happened, said in one line — the files restored, the memory —
 * and « Annuler le retour », until the conversation's next turn begins.
 */

import type { RewindWhatView } from '@aparte/bonaparte-shared';
import { formatDuration } from '../format';
import type { Messages } from '../i18n/index';

/** What going back did, as the core said it. */
export interface RewoundView {
  conversationId: string;
  what: RewindWhatView;
  excerpt: string;
  filesRestored: string[];
  conflicts: string[];
  memory: 'kept' | { kind: 'reread'; seconds: number } | null;
}

export interface RewindBannerProps {
  rewound: RewoundView;
  messages: Messages;
  locale: string;
  busy: boolean;
  onUndo(): void;
}

export function RewindBanner({ rewound, messages, locale, busy, onUndo }: RewindBannerProps) {
  const words = messages.rewind;
  const parts: string[] = [];
  if (rewound.what !== 'conversation' && rewound.filesRestored.length > 0) parts.push(words.bannerFiles(rewound.filesRestored.length));
  if (rewound.what === 'conversation') parts.push(words.bannerConversationOnly);
  if (rewound.what !== 'code' && rewound.memory === 'kept') parts.push(words.bannerMemoryKept);
  if (rewound.what !== 'code' && rewound.memory && rewound.memory !== 'kept') parts.push(words.bannerMemoryReread(formatDuration(rewound.memory.seconds, locale)));
  if (rewound.conflicts.length > 0) parts.push(words.bannerConflicts(rewound.conflicts.join(', ')));
  const head = rewound.what === 'code' ? words.bannerCode(rewound.excerpt) : words.banner(rewound.excerpt);
  return (
    <div className="aparte-alert aparte-alert--success rewind-banner" role="status">
      <div className="aparte-alert__body">
        <p className="aparte-alert__message">{[head, ...parts].join(' · ')}</p>
      </div>
      <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" disabled={busy} onClick={onUndo}>
        {words.undo}
      </button>
    </div>
  );
}
