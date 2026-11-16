/**
 * Compaction, as the window drives it (task 7.3). The context of the
 * conversation shown is read when it opens and when a turn ends: from 90 %
 * the banner says it, until « Continuer quand même » sets it aside for that
 * turn. « Compacter », « / compact », aparté's notice's « Réessayer » — all
 * one request (`aparte-compact`) — ask the core; done, aparté's checkpoint
 * (`contextSummary`) marks it in the thread, where the core placed it: on the
 * first message kept, else on the last answer. aparté's « Restaurer »
 * (`aparte-compact-done` restored) has the core go on from before it.
 */

import type { AparteChatImperativeApi } from '@aparte/react';
import {
  conversationsCompact,
  conversationsContext,
  conversationsUncompact,
  type ContextFullView,
} from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import type { CompactionState } from './ContextBanner';

export interface CompactionDeps {
  handles: Map<string, AparteChatImperativeApi>;
  /** The conversation shown, and how many turns ended: what makes its context read again. */
  conversationId: string | null;
  turnsEnded: number;
  messages: Messages;
  /** A compaction undone: the conversation's memory, to be read again, is said again. */
  onRestored(conversationId: string): void;
}

/** What the window holds of a message: its role, its id. */
interface ShownMessage {
  id: string;
  role: string;
}

export function useCompaction(deps: CompactionDeps) {
  const { conversationId, turnsEnded } = deps;
  const [context, setContext] = useState<ContextFullView | null>(null);
  const [state, setState] = useState<CompactionState | null>(null);
  const [setAside, setSetAside] = useState(false);
  const running = useRef(false);
  const latest = useRef(deps);
  latest.current = deps;

  // Read again when the conversation shown changes, and when a turn ends.
  useEffect(() => {
    setSetAside(false);
    if (!running.current) setState(null);
    if (!conversationId) {
      setContext(null);
      return;
    }
    let current = true;
    void bridge
      .invoke(conversationsContext, { id: conversationId })
      .then((view) => current && setContext(view))
      .catch(() => current && setContext(null));
    return () => {
      current = false;
    };
  }, [conversationId, turnsEnded]);

  const chatOf = (id: string): AparteChatImperativeApi | null => {
    for (const handle of latest.current.handles.values()) if (handle.getConversationId() === id) return handle;
    return null;
  };

  const compact = async (id: string): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setState({ kind: 'running' });
    try {
      const outcome = await bridge.invoke(conversationsCompact, { id });
      if (!outcome.ok) {
        setState({ kind: 'refused', reason: outcome.reason });
        return;
      }
      // aparté's checkpoint, where the core's rebase begins: the first message kept, else the last answer —
      // which aparté then counts, though the model no longer reads it (apartejs/aparte#246).
      const handle = chatOf(id);
      if (handle) {
        const shown = handle.getMessages() as unknown as ShownMessage[];
        const users = shown.flatMap((message, index) => (message.role === 'user' ? [index] : []));
        const at = outcome.keptTurns > 0 ? users[users.length - outcome.keptTurns] : shown.length - 1;
        const anchor = at === undefined ? undefined : shown[at];
        if (anchor && at !== undefined) {
          handle.updateMessage(anchor.id, {
            contextSummary: { summary: outcome.summary, count: outcome.keptTurns > 0 ? at : shown.length, createdAt: Date.now() },
          });
        }
      }
      setState(null);
      setContext(null);
    } catch {
      setState({ kind: 'refused', reason: 'failed' });
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    // One request, whoever asks: a button, the command, the notice's « Réessayer ».
    const asked = (event: Event): void => {
      const targetId = (event as CustomEvent<{ targetId?: string }>).detail?.targetId;
      const handle = targetId ? latest.current.handles.get(targetId) : undefined;
      const id = handle?.getConversationId() ?? latest.current.conversationId;
      if (id) void compact(id);
    };
    // « Restaurer »: the core goes on from before the compaction, its early turns read again.
    const undone = (event: Event): void => {
      const detail = (event as CustomEvent<{ restored?: boolean; targetId?: string }>).detail;
      if (!detail?.restored) return;
      const handle = detail.targetId ? latest.current.handles.get(detail.targetId) : undefined;
      const id = handle?.getConversationId() ?? latest.current.conversationId;
      if (!id) return;
      void bridge
        .invoke(conversationsUncompact, { id })
        .then(() => latest.current.onRestored(id))
        .catch(() => undefined);
    };
    // « / compact », in the composer's menu.
    const collect = (event: Event): void => {
      const detail = (event as CustomEvent<{ chat: HTMLElement | null; add(command: { id: string; name: string; description: string; order: number; run(): void }): void }>).detail;
      detail.add({
        id: 'compact',
        name: 'compact',
        description: latest.current.messages.compact.command,
        order: 200,
        run: () => window.dispatchEvent(new CustomEvent('aparte-compact', { detail: { ...(detail.chat?.id ? { targetId: detail.chat.id } : {}) } })),
      });
    };
    window.addEventListener('aparte-compact', asked);
    window.addEventListener('aparte-compact-done', undone);
    window.addEventListener('aparte-collect-commands', collect);
    return () => {
      window.removeEventListener('aparte-compact', asked);
      window.removeEventListener('aparte-compact-done', undone);
      window.removeEventListener('aparte-collect-commands', collect);
    };
  }, []);

  return {
    context: setAside ? null : context,
    state,
    compact: (id: string) => void compact(id),
    later: () => {
      setSetAside(true);
      setState(null);
    },
  };
}
