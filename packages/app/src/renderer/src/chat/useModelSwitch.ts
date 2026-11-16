/**
 * Changing model, as the window drives it (task 7.4). A model picked in the
 * composer opens the dialog, which asks the core what it would cost for the
 * conversation shown; « Annuler » puts the picker back. « Changer » has the
 * core load it (the memory saved first): the conversation goes on in it at
 * its next message, its re-reading already said. « Brancher sur ce modèle »
 * has the core copy the conversation and load it: the copy is listed and
 * shown. A refusal (a reply that runs, a model that cannot load) is said in
 * the dialog, and nothing moves.
 */

import type { AparteChatImperativeApi } from '@aparte/react';
import { engineSwitch, engineSwitchCost } from '@aparte/bonaparte-shared';
import { useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { ModelSwitchAsking, ModelSwitchRefusal } from '../dialogs/ModelSwitchDialog';
import { ENGINE_CHANGED } from '../settings/EngineMemory';

export interface ModelSwitchDeps {
  handles: Map<string, AparteChatImperativeApi>;
  /** The conversation shown; null: a new one, with nothing to read again. */
  conversationId: string | null;
  /** The copy made: listed again from the store, then shown. */
  showCopy(conversationId: string): Promise<void>;
  /** A change begins for this conversation: the dialog said its re-reading — no banner says it again. */
  onSwitching(conversationId: string | null): void;
  /** The change did not happen: what opening the conversation costs will be said as before. */
  onSwitchFailed(conversationId: string | null): void;
  /** The change made for this conversation. */
  onSwitched(conversationId: string | null): void;
}

interface Pending {
  path: string;
  conversationId: string | null;
  revert(): void;
}

export function useModelSwitch(deps: ModelSwitchDeps) {
  const [asking, setAsking] = useState<ModelSwitchAsking | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<ModelSwitchRefusal | null>(null);
  const pending = useRef<Pending | null>(null);
  const latest = useRef(deps);
  latest.current = deps;

  const hasHistory = (id: string | null): boolean => {
    if (!id) return false;
    for (const handle of latest.current.handles.values()) {
      if (handle.getConversationId() === id) return handle.getMessages().length > 0;
    }
    return false;
  };

  const ask = (path: string, name: string, revert: () => void): void => {
    const conversationId = latest.current.conversationId;
    pending.current = { path, conversationId, revert };
    setRefused(null);
    setBusy(false);
    setAsking({ name, view: null, hasHistory: hasHistory(conversationId) });
    void bridge
      .invoke(engineSwitchCost, { path, ...(conversationId ? { conversationId } : {}) })
      .then((view) => {
        if (pending.current?.path === path) setAsking((was) => (was ? { ...was, view } : was));
      })
      .catch(() => {
        if (pending.current?.path === path) setRefused('failed');
      });
  };

  // Closed without a change (« Annuler », Escape): the picker shows the model that runs again.
  const cancel = (): void => {
    const was = pending.current;
    pending.current = null;
    setAsking(null);
    setBusy(false);
    setRefused(null);
    was?.revert();
  };

  const change = async (as: 'here' | 'copy'): Promise<void> => {
    const was = pending.current;
    if (!was) return;
    setBusy(true);
    setRefused(null);
    // Only « Changer » moves this conversation: with « Brancher sur ce modèle » the copy does.
    if (as === 'here') latest.current.onSwitching(was.conversationId);
    const result = await bridge
      .invoke(engineSwitch, { path: was.path, ...(was.conversationId ? { conversationId: was.conversationId } : {}), as })
      .catch(() => null);
    if (pending.current !== was) return;
    setBusy(false);
    if (!result || !result.ok) {
      if (as === 'here') latest.current.onSwitchFailed(was.conversationId);
      setRefused(result ? result.error.code : 'failed');
      return;
    }
    // Done: closing the dialog now reverts nothing.
    pending.current = null;
    setAsking(null);
    window.dispatchEvent(new CustomEvent(ENGINE_CHANGED));
    latest.current.onSwitched(was.conversationId);
    if (as === 'copy' && result.conversationId) await latest.current.showCopy(result.conversationId);
  };

  return { asking, busy, refused, ask, cancel, change: (as: 'here' | 'copy') => void change(as) };
}
