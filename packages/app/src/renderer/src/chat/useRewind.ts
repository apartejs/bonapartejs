/**
 * Going back before a message, and the branches of a conversation (task
 * 7.2), as the window drives them: a message's « Revenir avant » asks the
 * core what would move and opens the dialog; « Revenir » moves, takes the
 * message and what followed out of the thread and gives the message back to
 * the composer; the banner offers « Annuler le retour » until the next turn
 * begins. A branch shown — by « Brancher », or by undoing — is read again
 * from the core and the conversation's chat mounted afresh on it. The
 * sibling answer the person picks in the chat is told to the core, which
 * makes its branch the one continued.
 */

import type { AparteActionEventDetail } from '@aparte/core';
import {
  conversationsFollowPath,
  conversationsLoadFull,
  conversationsRewind,
  conversationsRewindPreview,
  conversationsSwitchBranch,
  conversationsUndoRewind,
  type RewindWhatView,
} from '@aparte/bonaparte-shared';
import type { AparteChatImperativeApi } from '@aparte/react';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import { BRANCHES_ACTION, REWIND_ACTION } from '../aparte/message-actions';
import type { RewindPreviewView } from '../dialogs/RewindDialog';
import type { RewoundView } from './RewindBanner';

interface Asking {
  conversationId: string;
  chatKey: string;
  messageId: string;
  userIndex: number;
  text: string;
  excerpt: string;
  preview: RewindPreviewView | null;
}

/** What the window holds of a message: its role, its id, its words. */
interface ShownMessage {
  id: string;
  role: string;
  content?: unknown;
}

const excerpt = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

const textOf = (content: unknown): string => (typeof content === 'string' ? content : '');

/** React has drawn what it was given, and the elements have said what they say. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => resolve()), 0));

export interface RewindDeps {
  handles: Map<string, AparteChatImperativeApi>;
  /** The conversation's messages as aparté's manager keeps them (and saves them), replaced. */
  replaceMessages(id: string, messages: unknown[], tree: unknown): Promise<void>;
  /** The conversation's chat taken down, then mounted again on what the manager holds. */
  unmount(id: string): void;
  mount(id: string): void;
  /** The branch menu, opened on the branches that part from the person's message. */
  openBranchesAt(conversationId: string, userIndex: number): void;
  /** Something moved on disk or in the conversation: the panes and the rows read again. */
  changed(): void;
}

export function useRewind(deps: RewindDeps) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [rewound, setRewound] = useState<RewoundView | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(deps);
  latest.current = deps;
  // While a branch is read again, the chats' paths are ours, not a sibling the person picked.
  const reloading = useRef(0);

  /** A message of the person's, named as the core checks it: its rank among their messages of the path shown. */
  const named = (detail: Pick<AparteActionEventDetail, 'messageId' | 'targetId'>) => {
    const chatKey = detail.targetId;
    if (!chatKey) return null;
    const handle = latest.current.handles.get(chatKey);
    const conversationId = handle?.getConversationId();
    if (!handle || !conversationId || !detail.messageId || handle.isStreaming()) return null;
    const shown = handle.getMessages() as unknown as ShownMessage[];
    const index = shown.findIndex((message) => message.id === detail.messageId);
    if (index < 0 || shown[index]!.role !== 'user') return null;
    const userIndex = shown.slice(0, index).filter((message) => message.role === 'user').length;
    return { chatKey, conversationId, messageId: detail.messageId, userIndex, text: textOf(shown[index]!.content) };
  };

  useEffect(() => {
    const acted = (event: Event): void => {
      const detail = (event as CustomEvent<AparteActionEventDetail>).detail;
      if (detail.actionId !== REWIND_ACTION && detail.actionId !== BRANCHES_ACTION) return;
      const message = named(detail);
      if (!message) return;
      if (detail.actionId === BRANCHES_ACTION) {
        latest.current.openBranchesAt(message.conversationId, message.userIndex);
        return;
      }
      setAsking({ ...message, excerpt: excerpt(message.text), preview: null });
      void bridge
        .invoke(conversationsRewindPreview, { id: message.conversationId, userIndex: message.userIndex, text: message.text })
        .then((preview) => setAsking((was) => (was && was.messageId === message.messageId ? { ...was, preview } : was)))
        .catch(() => setAsking(null));
    };
    document.addEventListener('aparte-action', acted);
    return () => document.removeEventListener('aparte-action', acted);
  }, []);

  // The sibling answer picked in the chat: the core continues its branch.
  useEffect(() => {
    const moved = (event: Event): void => {
      const detail = (event as CustomEvent<{ messages?: ShownMessage[]; targetId?: string }>).detail;
      const handle = detail?.targetId ? latest.current.handles.get(detail.targetId) : undefined;
      const conversationId = handle?.getConversationId();
      if (!handle || !conversationId || handle.isStreaming() || reloading.current > 0) return;
      const answers = (detail.messages ?? []).filter((message) => message.role === 'assistant').map((message) => message.id);
      if (answers.length === 0) return;
      void bridge.invoke(conversationsFollowPath, { id: conversationId, messageIds: answers }).catch(() => undefined);
    };
    window.addEventListener('aparte-path-changed', moved);
    return () => window.removeEventListener('aparte-path-changed', moved);
  }, []);

  // Once a turn starts, going back can no longer be undone: the banner goes.
  useEffect(() => {
    const started = (): void => setRewound(null);
    window.addEventListener('aparte-message-start', started);
    return () => window.removeEventListener('aparte-message-start', started);
  }, []);

  /**
   * A branch the core now shows, read again: the chat taken down first — so that nothing of the one left is
   * written back —, the manager given the branch, the chat mounted on it.
   */
  const reload = async (id: string): Promise<void> => {
    reloading.current += 1;
    try {
      latest.current.unmount(id);
      await settled();
      const document = (await bridge.invoke(conversationsLoadFull, { id })) as { messages?: unknown[]; tree?: unknown } | null;
      if (document) await latest.current.replaceMessages(id, document.messages ?? [], document.tree);
      latest.current.mount(id);
      await settled();
    } finally {
      reloading.current -= 1;
    }
  };

  const rewind = async (what: RewindWhatView): Promise<void> => {
    const asked = asking;
    if (!asked) return;
    setBusy(true);
    try {
      const result = await bridge.invoke(conversationsRewind, { id: asked.conversationId, userIndex: asked.userIndex, text: asked.text, what });
      const handle = latest.current.handles.get(asked.chatKey);
      if (what !== 'code' && handle) {
        // The message and what followed leave the thread — kept so, the branch shown now —; the message comes back to the composer.
        reloading.current += 1;
        try {
          handle.truncateFrom(asked.messageId);
          const viewport = handle.getViewport() as { exportTree?(): unknown } | null;
          await latest.current.replaceMessages(asked.conversationId, handle.getMessages(), viewport?.exportTree?.());
          await settled();
        } finally {
          reloading.current -= 1;
        }
        (handle.getComposer() as { setValue?(text: string): void } | null)?.setValue?.(result.text);
        handle.focusInput();
      }
      setRewound({
        conversationId: asked.conversationId,
        what,
        excerpt: asked.excerpt,
        filesRestored: result.filesRestored,
        conflicts: result.conflicts,
        memory: result.memory,
      });
      latest.current.changed();
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  const undo = async (): Promise<void> => {
    const done = rewound;
    if (!done) return;
    setBusy(true);
    try {
      const result = await bridge.invoke(conversationsUndoRewind, { id: done.conversationId });
      if (result && done.what !== 'code') {
        for (const handle of latest.current.handles.values()) {
          if (handle.getConversationId() === done.conversationId) (handle.getComposer() as { setValue?(text: string): void } | null)?.setValue?.('');
        }
        await reload(done.conversationId);
      }
      latest.current.changed();
    } finally {
      setBusy(false);
      setRewound(null);
    }
  };

  /** « Brancher »: another branch shown. */
  const showBranch = async (conversationId: string, branchId: string): Promise<void> => {
    await bridge.invoke(conversationsSwitchBranch, { id: conversationId, branchId });
    setRewound(null);
    await reload(conversationId);
    latest.current.changed();
  };

  return {
    asking: asking ? { excerpt: asking.excerpt, preview: asking.preview } : null,
    rewound,
    busy,
    cancel: () => setAsking(null),
    rewind: (what: RewindWhatView) => void rewind(what),
    undo: () => void undo(),
    showBranch: (conversationId: string, branchId: string) => void showBranch(conversationId, branchId),
  };
}
