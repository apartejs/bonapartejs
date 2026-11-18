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

  /** « Revenir avant » asked on a message of the person's: its dialog, its cost read before anything moves. */
  const ask = (detail: Pick<AparteActionEventDetail, 'messageId' | 'targetId'>): boolean => {
    const message = named(detail);
    if (!message) return false;
    setAsking({ ...message, excerpt: excerpt(message.text), preview: null });
    void bridge
      .invoke(conversationsRewindPreview, { id: message.conversationId, userIndex: message.userIndex, text: message.text })
      .then((preview) => setAsking((was) => (was && was.messageId === message.messageId ? { ...was, preview } : was)))
      .catch(() => setAsking(null));
    return true;
  };

  useEffect(() => {
    const acted = (event: Event): void => {
      const detail = (event as CustomEvent<AparteActionEventDetail>).detail;
      if (detail.actionId !== REWIND_ACTION && detail.actionId !== BRANCHES_ACTION) return;
      if (detail.actionId === BRANCHES_ACTION) {
        const message = named(detail);
        if (message) latest.current.openBranchesAt(message.conversationId, message.userIndex);
        return;
      }
      ask(detail);
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

  /** The chat of a conversation once mounted with its composer — a few frames at most; null when it never comes. */
  const chatOf = async (id: string): Promise<AparteChatImperativeApi | null> => {
    for (let frame = 0; frame < 60; frame += 1) {
      for (const handle of latest.current.handles.values()) {
        if (handle.getConversationId() === id && handle.getComposer()) {
          await settled();
          return handle;
        }
      }
      await settled();
    }
    return null;
  };

  /**
   * The conversation's chat taken down before the core moves its branch: a chat leaving writes its thread
   * back — to the manager and, through the bridge, to the core —, which must land before the core swaps
   * the branches' documents, never after.
   */
  const takeDown = async (id: string): Promise<void> => {
    reloading.current += 1;
    latest.current.unmount(id);
    for (let frame = 0; frame < 60 && [...latest.current.handles.values()].some((handle) => handle.getConversationId() === id); frame += 1) {
      await settled();
    }
    await settled();
    await settled();
  };

  /** The branch the core shows now, read again: the manager given it, the chat mounted on it. */
  const bringBack = async (id: string): Promise<void> => {
    try {
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
      // The new branch is the core's cut of the window's document (the message and what followed gone): the
      // chat is taken down first and mounted on it afresh — never cut in place, where its own saving could
      // write the old thread back.
      if (what !== 'code') await takeDown(asked.conversationId);
      let result;
      try {
        result = await bridge.invoke(conversationsRewind, {
          id: asked.conversationId,
          userIndex: asked.userIndex,
          text: asked.text,
          what,
          messageId: asked.messageId,
        });
      } finally {
        if (what !== 'code') await bringBack(asked.conversationId);
      }
      if (what !== 'code') {
        // The message comes back to the composer of the chat mounted, once it has one.
        const mounted = await chatOf(asked.conversationId);
        if (mounted) {
          (mounted.getComposer() as { setValue?(text: string): void } | null)?.setValue?.(result.text);
          mounted.focusInput();
        }
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
      if (done.what !== 'code') await takeDown(done.conversationId);
      try {
        await bridge.invoke(conversationsUndoRewind, { id: done.conversationId });
      } finally {
        if (done.what !== 'code') await bringBack(done.conversationId);
      }
      latest.current.changed();
    } finally {
      setBusy(false);
      setRewound(null);
    }
  };

  /** « Brancher »: another branch shown. */
  const showBranch = async (conversationId: string, branchId: string): Promise<void> => {
    setRewound(null);
    await takeDown(conversationId);
    try {
      await bridge.invoke(conversationsSwitchBranch, { id: conversationId, branchId });
    } finally {
      await bringBack(conversationId);
    }
    latest.current.changed();
  };

  return {
    asking: asking ? { excerpt: asking.excerpt, preview: asking.preview } : null,
    rewound,
    busy,
    cancel: () => setAsking(null),
    /** Ctrl Alt Z (task 12.1): « Revenir avant » on the last message of the person's in this chat. */
    askLast: (chatKey: string): boolean => {
      const shown = (latest.current.handles.get(chatKey)?.getMessages() ?? []) as unknown as ShownMessage[];
      const last = [...shown].reverse().find((message) => message.role === 'user');
      return last ? ask({ messageId: last.id, targetId: chatKey }) : false;
    },
    rewind: (what: RewindWhatView) => void rewind(what),
    undo: () => void undo(),
    showBranch: (conversationId: string, branchId: string) => void showBranch(conversationId, branchId),
  };
}
