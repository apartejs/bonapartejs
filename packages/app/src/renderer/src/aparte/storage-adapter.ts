/**
 * aparté's storage adapter of the window. Each gesture of the page goes to
 * the core through the bridge: the core keeps aparté's document of a
 * conversation beside its journal, which stays the truth of what was said.
 * The page keeps nothing of its own.
 */

import {
  conversationsDelete,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsSave,
  type Bridge,
  type ConversationDocument,
} from '@aparte/bonaparte-shared';
import type { AparteConversation, AparteStorageAdapter } from '@aparte/core';

export function createStorageAdapter(bridge: Bridge): AparteStorageAdapter {
  return {
    loadAll: async () => (await bridge.invoke(conversationsLoadAll, undefined)) as unknown as AparteConversation[],
    loadFull: async (id) => (await bridge.invoke(conversationsLoadFull, { id })) as unknown as AparteConversation | null,
    save: (conversation) => bridge.invoke(conversationsSave, { document: conversation as unknown as ConversationDocument }),
    delete: (id) => bridge.invoke(conversationsDelete, { id }),
  };
}
